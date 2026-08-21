/**
 * Modell-Namensauflösung mit Fallback-Kette — Portierung von
 * ~/dev/ocgo-price-tracker/scripts/scrape.mjs (`buildModelsDevLookup`).
 *
 * Reihenfolge (normalizeName = lowercase ohne Leerzeichen/Bindestriche):
 *  1. "opencode"-Provider (per normalisierter ID, dann per Name)
 *  2. kanonischer Katalog über ALLE Provider (per normalisiertem Namen;
 *     bei Kollisionen exakter ID-Treffer, sonst erster nach ID sortiert)
 *  3. "opencode-go"-Provider (per normalisierter ID, dann per Name)
 *
 * `publicModelName` entfernt Klammer-Zusätze wie „(Unlimited)“ — nur für
 * Stealth-/Free-Modelle gedacht (siehe manufacturers.isStealthModel); bei
 * Tier-Modellen (z.B. „(≤ 272K tokens)“) bleibt der Zusatz erhalten.
 */

export interface LookupModel {
  id: string;
  name?: string;
  family?: string | null;
  limit?: { context?: number | null } | null;
}

/** Strukturell kompatibel zu @opencode-ai/models `ProviderMap`. */
export type ProviderMapLike = Record<
  string,
  { name?: string; models?: Record<string, LookupModel> } | undefined
>;

export interface ModelLookup {
  /** Liefert das passende Katalog-Modell oder null. */
  resolve(id: string, name?: string): LookupModel | null;
}

const PREFERRED_FIRST = "opencode";
const PREFERRED_LAST = "opencode-go";

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s-]+/g, "");
}

/** Entfernt einen trailing Klammer-Zusatz: "Ox Alpha Free (Unlimited)" → "Ox Alpha Free". */
export function publicModelName(
  name: string | null | undefined,
): string | undefined {
  const stripped = name?.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped || undefined;
}

export function buildModelLookup(providers: ProviderMapLike): ModelLookup {
  // Bevorzugte Provider: opencode zuerst, opencode-go als Lückenfüller.
  const firstById = new Map<string, LookupModel>();
  const firstByName = new Map<string, LookupModel>();
  const lastById = new Map<string, LookupModel>();
  const lastByName = new Map<string, LookupModel>();

  // Kanonische Metadaten über alle Provider, gruppiert nach normalisiertem Namen.
  const canonByName = new Map<string, LookupModel[]>();
  for (const provider of Object.values(providers)) {
    if (!provider?.models) continue;
    for (const model of Object.values(provider.models)) {
      if (!model?.id) continue;
      const norm = normalizeName(model.name ?? "");
      if (norm) {
        const list = canonByName.get(norm) ?? [];
        list.push(model);
        canonByName.set(norm, list);
      }
    }
  }

  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider?.models) continue;
    const target =
      providerId === PREFERRED_FIRST
        ? { byId: firstById, byName: firstByName }
        : providerId === PREFERRED_LAST
          ? { byId: lastById, byName: lastByName }
          : null;
    if (!target) continue;
    for (const model of Object.values(provider.models)) {
      if (!model?.id) continue;
      target.byId.set(normalizeName(model.id), model);
      const norm = normalizeName(model.name ?? "");
      if (norm) target.byName.set(norm, model);
    }
  }

  const resolveCanon = (name: string): LookupModel | null => {
    const norm = normalizeName(name);
    const candidates = canonByName.get(norm);
    if (!candidates?.length) return null;
    return (
      candidates.find((c) => normalizeName(c.id) === norm) ??
      [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0] ??
      null
    );
  };

  const resolve = (id: string, name?: string): LookupModel | null => {
    const norm = normalizeName(id);
    return (
      firstById.get(norm) ??
      firstByName.get(norm) ??
      (name ? resolveCanon(name) : null) ??
      lastById.get(norm) ??
      (name ? lastByName.get(normalizeName(name)) ?? null : null)
    );
  };

  return { resolve };
}
