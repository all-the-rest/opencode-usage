/**
 * Model / provider metadata resolution.
 *
 * The analysis DB stores provider_id + model_id strings. To present human
 * friendly names, families and context windows we consult the bundled
 * `@opencode-ai/models` snapshot (no network needed). Many opencode-specific
 * model IDs are not in the published catalog, so everything degrades
 * gracefully to the raw id and a family derived from a heuristic.
 */
import { providers } from "@opencode-ai/models/snapshot";

export interface ModelMeta {
  providerName: string;
  modelName: string;
  family: string | null;
  contextWindow: number | null;
}

/**
 * Derive a model "family" from its id when no catalog metadata is available.
 * Strategy: drop any provider prefix (`org/name`), drop free/local suffixes,
 * then cut at the first digit (the version number). e.g.
 *   "ling-3.0-flash-free" -> "ling"
 *   "deepseek-v4-flash"    -> "deepseek"
 *   "qwen/qwen3.6-35b-a3b" -> "qwen"
 *   "DeepSeek-V4-Flash"    -> "deepseek"
 */
export function heuristicFamily(modelId: string): string {
  let s = modelId.toLowerCase();
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/:free$/, "").replace(/-free$/, "").replace(/-local$/, "");
  const digitIdx = s.search(/\d/);
  if (digitIdx > 0) {
    let fam = s.slice(0, digitIdx).replace(/[-_.\s]+$/, "");
    // A trailing "v"/"V" directly before the version digit is a version
    // marker (e.g. "deepseek-v4" -> "deepseek"), not part of the family.
    if (/[vV]$/.test(fam) && (s[digitIdx - 1] ?? "").toLowerCase() === "v") {
      fam = fam.replace(/[-_.\s]*[vV]$/, "");
    }
    return fam;
  }
  return s.split(/[-_.\s/]+/)[0] ?? s;
}

/**
 * Resolve provider/model metadata, falling back to raw ids.
 * `family` is ALWAYS derived heuristically from the model id (per the API
 * contract: "family via Heuristik aus model_id"), so it is consistent between
 * the models breakdown and the timeseries family grouping. Provider/model
 * names and the context window come from the catalog when available.
 */
export function resolveModelMeta(
  providerId: string,
  modelId: string,
): ModelMeta {
  const provider = providers[providerId];
  const providerName = provider?.name ?? providerId;
  const model = provider?.models?.[modelId];
  const modelName = model?.name ?? modelId;
  const contextWindow = model?.limit?.context ?? null;
  const family = heuristicFamily(modelId);
  return { providerName, modelName, family, contextWindow };
}

/** Convenience: just the family key (used for timeseries grouping). */
export function familyKey(providerId: string, modelId: string): string {
  return resolveModelMeta(providerId, modelId).family ?? heuristicFamily(modelId);
}
