/**
 * Model / provider metadata resolution.
 *
 * The analysis DB stores provider_id + model_id strings. To present human
 * friendly names, families and context windows we consult the models.dev
 * catalog LIVE (fetched at startup + refreshed every CATALOG_TTL_MS, same
 * source the frontend uses), resolved through the ocgo-price-tracker fallback
 * chain (see src/lib/model-lookup.ts): opencode → global catalog →
 * opencode-go. The bundled `@opencode-ai/models` snapshot stays the offline
 * fallback (see "Katalog-Quelle" below) — resolution itself is synchronous.
 *
 * Die Family kommt bei normalen Modellen ZUERST aus den kuratierten
 * Family-Overrides (MANUAL_FAMILY_RULES), dann aus dem `family`-Feld des
 * Katalogs (direkter Provider-Treffer oder Fallback-Kette); nur ohne beides
 * greift die ID-Heuristik (heuristicFamily). Stealth-Modelle
 * (siehe manual-manufacturers.ts) sind standalone: ihr Name ist der
 * öffentliche Katalogname ohne Klammer-Zusatz und ihre Family ist der
 * gemeinsame Stealth-Hersteller-Name — weder Katalog noch ID-Heuristik.
 */
import { Models as ModelsClient } from "@opencode-ai/models";
import { providers as bundledProviders } from "@opencode-ai/models/snapshot";
import {
  buildModelLookup,
  publicModelName,
  type ModelLookup,
  type ProviderMapLike,
} from "../src/lib/model-lookup";
import {
  isStealthModel,
  normalizeModelId,
  STEALTH_MANUFACTURER,
} from "../src/lib/manufacturers";
import { matchManualFamily } from "../src/lib/manual-manufacturers";

export interface ModelMeta {
  providerName: string;
  modelName: string;
  family: string | null;
  contextWindow: number | null;
}

// ---------------------------------------------------------------------------
// Katalog-Quelle: live (models.dev) mit gebündeltem Snapshot als Fallback
// ---------------------------------------------------------------------------
/**
 * Der gebündelte Snapshot (@opencode-ai/models/snapshot) wird nur EINMAL pro
 * Tag gebaut — jedes danach veröffentlichte Modell ist bis zu ~24 h
 * unbekannt, und Name/Family/Context-Fenster fallen auf die ID-Heuristik
 * zurück, die nur in ~38 % der Fälle die kuratierte Family trifft. Weil das
 * Frontend denselben Katalog live abfragt, lief der Server dauerhaft eine
 * ANDERE Sicht als das UI (sichtbar z.B. bei `longcat-2.5-preview-free`:
 * Family aus dem Server, Name/Context aus dem Live-Client). Deshalb holt der
 * Server den Katalog jetzt selbst — beim Start und danach im Takt von
 * CATALOG_TTL_MS im Hintergrund.
 *
 * Verhalten bei Fehlern (offline, DNS, 5xx, Timeout): die zuletzt gültige
 * Quelle bleibt aktiv, ganz am Anfang der gebündelte Snapshot. Die Auflösung
 * selbst bleibt synchron — `activeProviders`/`activeLookup` werden nur im
 * Hintergrund ausgetauscht, nie mitten in einem Request.
 */
const SNAPSHOT_PROVIDERS = bundledProviders as ProviderMapLike;

let activeProviders: ProviderMapLike = SNAPSHOT_PROVIDERS;
let activeLookup: ModelLookup = buildModelLookup(SNAPSHOT_PROVIDERS);
let liveFetchedAt: number | null = null;
let liveError: string | null = null;
let refreshing = false;

/** Refresh-Intervall des Live-Katalogs (6 h — er ändert sich selten). */
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/** Timeout für einen Abruf: der Server-Start darf nie hängen bleiben. */
const CATALOG_TIMEOUT_MS = 5000;

/**
 * Plausibilitäts-Guard: ein abgeschnittener/veränderter Payload wird
 * verworfen, statt die bisher gültige Quelle zu ersetzen.
 */
const CATALOG_MIN_PROVIDERS = 50;

/** `LIVE_CATALOG=off|0|false` erzwingt den gebündelten Snapshot (z.B. offline). */
const liveEnabled = !["off", "0", "false"].includes(
  (process.env.LIVE_CATALOG ?? "").toLowerCase(),
);

export interface CatalogStatus {
  /** `live` = models.dev, `snapshot` = gebündelter @opencode-ai/models. */
  source: "live" | "snapshot";
  providers: number;
  /** Epoch-ms des letzten erfolgreichen Live-Abrufs, null bei Snapshot. */
  fetchedAt: number | null;
  /** Letzter Fehlertext, null wenn der letzte Abruf OK war. */
  error: string | null;
}

export function catalogStatus(): CatalogStatus {
  return {
    source: liveFetchedAt != null ? "live" : "snapshot",
    providers: Object.keys(activeProviders).length,
    fetchedAt: liveFetchedAt,
    error: liveError,
  };
}

/**
 * Katalog von models.dev holen und zur aktiven Quelle machen. Nie werfend:
 * jeder Fehler lässt die bisherige Quelle (bzw. den Snapshot) aktiv.
 */
export async function refreshLiveCatalog(): Promise<CatalogStatus> {
  if (!liveEnabled) {
    liveError = "disabled via LIVE_CATALOG";
    return catalogStatus();
  }
  // Kein Overlapping-Refresh (Timer + Startup).
  if (refreshing) return catalogStatus();
  refreshing = true;
  try {
    const catalog = await ModelsClient.make().catalog({
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    const map = catalog.providers as ProviderMapLike;
    const count = Object.keys(map).length;
    if (count < CATALOG_MIN_PROVIDERS) {
      throw new Error(`implausible provider count: ${count}`);
    }
    // Lookup erst bauen, dann tauschen — nie einen halbfertigen Stand aktivieren.
    const nextLookup = buildModelLookup(map);
    activeLookup = nextLookup;
    activeProviders = map;
    liveFetchedAt = Date.now();
    liveError = null;
    console.log(`[metadata] live models.dev catalog loaded (${count} providers)`);
  } catch (e) {
    liveError = e instanceof Error ? e.message : String(e);
    console.warn(
      `[metadata] live catalog unavailable (${liveError}) — keeping ` +
        `${liveFetchedAt != null ? "last live catalog" : "bundled snapshot"}`,
    );
  } finally {
    refreshing = false;
  }
  return catalogStatus();
}

/**
 * Periodischer Refresh im Hintergrund. `unref()`, damit der Timer den
 * Prozess nicht am Leben hält.
 */
export function startCatalogRefresh(): void {
  if (!liveEnabled) return;
  setInterval(() => void refreshLiveCatalog(), CATALOG_TTL_MS).unref();
}

/**
 * Anzeigenamen für Custom-/Local-Provider, die nicht im Katalog stehen.
 * „openai-local" ist der OpenAI-kompatible Local-Server von LM Studio
 * (gleiche Modell-IDs wie der lmstudio-Provider, eigener Endpoint).
 */
const PROVIDER_NAME_OVERRIDES: Record<string, string> = {
  "openai-local": "LMStudio",
};

/**
 * Kuratierte `family` aus dem gebündelten Snapshot — zuerst der direkte
 * Treffer im eigenen Provider (`providers[providerId].models[modelId]`),
 * dann die ocgo-price-tracker-Fallback-Kette (opencode → global →
 * opencode-go). Null, wenn der Katalog nichts hergibt.
 */
function catalogFamily(providerId: string, modelId: string): string | null {
  // Kuratierte Family-Overrides ZUERST (manual-manufacturers.ts) — sie
  // korrigieren inkonsistente Katalog-Slugs (z.B. „deepseek-thinking“,
  // „muse-free“, „mimo-v2.5“) und schlagen daher Katalog UND Heuristik.
  const bareId = normalizeModelId(modelId).toLowerCase();
  const manual = matchManualFamily(bareId);
  if (manual) return manual;
  const direct = activeProviders[providerId]?.models?.[modelId]?.family;
  if (direct) return direct;
  const viaChain =
    activeLookup.resolve(modelId)?.family ??
    activeLookup.resolve(providerId, modelId)?.family;
  return viaChain || null;
}

/**
 * Rausch-Token, die KEINEN Teil der Family ausmachen. Sie stehen in der
 * model_id als Suffix oder Prefix und dürfen die Family nicht aufspalten:
 * `glm-5.2-preview` und `glm-5.2` sind dieselbe Linie. Bewusst NICHT
 * enthalten: Tier-Bezeichnungen (flash/max/plus/pro/thinking/…) — die sind
 * je nach Anbieter echte Family-Unterscheidungen (Qwen: max/plus/flash) und
 * werden über MANUAL_FAMILY_RULES bzw. den Katalog gesteuert.
 */
const FAMILY_NOISE = new Set([
  "preview",
  "exp",
  "experimental",
  "latest",
  "free",
  "local",
  "ga",
  "te",
  "tee",
  "flex",
  "speed",
  "ultraspeed",
  "highspeed",
  "beta",
  "rc",
]);

/**
 * Derive a model "family" from its id — ONLY as fallback when neither the
 * curated override nor the catalog yields a `family`.
 * Strategy: lowercase, drop any provider prefix (`org/name`), drop
 * free/local suffixes, then split on [-_.] and discard EVERY token that
 * contains a digit (versions like "5.6"/"v4", sizes like "35b"/"a3b"/"fp8",
 * dates like "0731") as well as the FAMILY_NOISE qualifier tokens; join the
 * rest with "-". Empty result → first id token.
 * e.g.
 *   "gpt-5.6-luna"          -> "gpt-luna"
 *   "claude-sonnet-4-6"     -> "claude-sonnet"
 *   "DeepSeek-V4-Flash-0731" -> "deepseek-flash"
 *   "Qwen/Qwen3.6-35B-A3B-FP8" -> "qwen"
 *   "hy3-free"              -> "hy"
 *   "glm-4.7-free"          -> "glm"
 *   "glm-5.2-preview"       -> "glm"   (nicht "glm-preview")
 *   "gpt-5.3-codex-spark"   -> "gpt-codex-spark"
 */
export function heuristicFamily(modelId: string): string {
  let s = modelId.toLowerCase();
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/:free$/, "").replace(/-free$/, "").replace(/-local$/, "");
  const kept = s
    .split(/[-_.]+/)
    .filter(
      (tok) => tok.length > 0 && !/\d/.test(tok) && !FAMILY_NOISE.has(tok),
    );
  if (kept.length > 0) return kept.join("-");
  // Fallback „erstes ID-Token": Präfix bis zur ersten Ziffer (z. B.
  // "Qwen3.6-…" -> "qwen"); ganz ohne Ziffer erstes Separator-Token.
  const digitIdx = s.search(/\d/);
  if (digitIdx > 0) {
    const prefix = s.slice(0, digitIdx).replace(/[-_.\s]+$/, "");
    if (prefix) return prefix;
  }
  return s.split(/[-_.]/)[0] ?? s;
}

/**
 * Resolve provider/model metadata, falling back to raw ids.
 *
 * Resolution order for name/context:
 *   1. direkter Treffer im eigenen Provider (`providers[providerId]`)
 *   2. Fallback-Kette aus model-lookup.ts (opencode → global → opencode-go)
 *
 * `family`: ZUERST kuratierte Family-Overrides (MANUAL_FAMILY_RULES), dann
 * die kuratierte Katalog-Family (direkter Provider-Treffer oder Fallback-
 * Kette, siehe catalogFamily), NUR ohne beides die ID-Heuristik
 * (heuristicFamily) — per API-Contract konsistent zwischen Models-Breakdown
 * und Timeseries-Grouping. Stealth-Modelle sind standalone und teilen sich
 * STEALTH_MANUFACTURER als Family.
 */
export function resolveModelMeta(
  providerId: string,
  modelId: string,
): ModelMeta {
  const provider = activeProviders[providerId];
  const direct = provider?.models?.[modelId];
  const resolved =
    direct ??
    activeLookup.resolve(modelId) ??
    activeLookup.resolve(providerId, modelId);
  // Stealth: öffentlicher Name ohne Klammer-Zusatz ("(Unlimited)" etc.).
  // Sonst: direkter Katalogname (inkl. Tier-Zusätzen wie "(≤ 272K tokens)").
  const modelName = isStealthModel(modelId)
    ? (publicModelName(resolved?.name) ?? modelId)
    : (direct?.name ?? resolved?.name ?? modelId);
  const contextWindow = direct?.limit?.context ?? resolved?.limit?.context ?? null;
  const family = isStealthModel(modelId)
    ? STEALTH_MANUFACTURER
    : (catalogFamily(providerId, modelId) ?? heuristicFamily(modelId));
  return {
    providerName: PROVIDER_NAME_OVERRIDES[providerId] ?? provider?.name ?? providerId,
    modelName,
    family,
    contextWindow,
  };
}

/**
 * Convenience: just the family key (used for timeseries grouping).
 * Stealth-Modelle bilden ihren eigenen Standalone-Bucket unter dem
 * gemeinsamen Stealth-Namen; sonst gelten kuratierte Family-Overrides,
 * kuratierte Katalog-Family (catalogFamily) und — nur ohne beides — die
 * ID-Heuristik.
 */
export function familyKey(providerId: string, modelId: string): string {
  if (isStealthModel(modelId)) return STEALTH_MANUFACTURER;
  return catalogFamily(providerId, modelId) ?? heuristicFamily(modelId);
}
