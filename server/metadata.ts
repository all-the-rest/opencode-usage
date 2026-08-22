/**
 * Model / provider metadata resolution.
 *
 * The analysis DB stores provider_id + model_id strings. To present human
 * friendly names, families and context windows we consult the bundled
 * `@opencode-ai/models` snapshot (no network needed), resolved through the
 * ocgo-price-tracker fallback chain (see src/lib/model-lookup.ts):
 * opencode → global catalog → opencode-go.
 *
 * Die Family kommt bei normalen Modellen ZUERST aus den kuratierten
 * Family-Overrides (MANUAL_FAMILY_RULES), dann aus dem `family`-Feld des
 * Snapshots (direkter Provider-Treffer oder Fallback-Kette); nur ohne beides
 * greift die ID-Heuristik (heuristicFamily). Stealth-Modelle
 * (siehe manual-manufacturers.ts) sind standalone: ihr Name ist der
 * öffentliche Katalogname ohne Klammer-Zusatz und ihre Family ist der
 * gemeinsame Stealth-Hersteller-Name — weder Katalog noch ID-Heuristik.
 */
import { providers } from "@opencode-ai/models/snapshot";
import {
  buildModelLookup,
  publicModelName,
  type ProviderMapLike,
} from "../src/lib/model-lookup";
import {
  isStealthModel,
  normalizeModelId,
  STEALTH_MANUFACTURER,
} from "../src/lib/manufacturers";
import { MANUAL_FAMILY_RULES } from "../src/lib/manual-manufacturers";

export interface ModelMeta {
  providerName: string;
  modelName: string;
  family: string | null;
  contextWindow: number | null;
}

// Fallback-Kette einmalig über den gebündelten Snapshot aufbauen.
const lookup = buildModelLookup(providers as ProviderMapLike);

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
  // korrigieren inkonsistente Katalog-Slugs (z.B. „muse-free“, „mimo-v2.5“)
  // und schlagen daher Katalog UND Heuristik.
  const bareId = normalizeModelId(modelId).toLowerCase();
  for (const [pattern, family] of MANUAL_FAMILY_RULES) {
    if (bareId.includes(pattern)) return family;
  }
  const direct = providers[providerId]?.models?.[modelId]?.family;
  if (direct) return direct;
  const viaChain =
    lookup.resolve(modelId)?.family ??
    lookup.resolve(providerId, modelId)?.family;
  return viaChain || null;
}

/**
 * Derive a model "family" from its id — ONLY as fallback when neither the
 * direct provider hit nor the lookup chain yields a curated `family`.
 * Strategy: lowercase, drop any provider prefix (`org/name`), drop
 * free/local suffixes, then split on [-_.] and discard EVERY token that
 * contains a digit (versions like "5.6"/"v4", sizes like "35b"/"a3b"/"fp8",
 * dates like "0731"); join the rest with "-". Empty result → first id token.
 * e.g.
 *   "gpt-5.6-luna"          -> "gpt-luna"
 *   "claude-sonnet-4-6"     -> "claude-sonnet"
 *   "DeepSeek-V4-Flash-0731" -> "deepseek-flash"
 *   "Qwen/Qwen3.6-35B-A3B-FP8" -> "qwen"
 *   "hy3-free"              -> "hy"
 *   "glm-4.7-free"          -> "glm"
 *   "gpt-5.3-codex-spark"   -> "gpt-codex-spark"
 */
export function heuristicFamily(modelId: string): string {
  let s = modelId.toLowerCase();
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/:free$/, "").replace(/-free$/, "").replace(/-local$/, "");
  const kept = s
    .split(/[-_.]+/)
    .filter((tok) => tok.length > 0 && !/\d/.test(tok));
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
  const provider = providers[providerId];
  const direct = provider?.models?.[modelId];
  const resolved =
    direct ?? lookup.resolve(modelId) ?? lookup.resolve(providerId, modelId);
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
