/**
 * Statische Zuordnung Modell → Hersteller (Company/Org).
 *
 * models.dev liefert nur family-Slugs (z.B. "Hy"), aber kein Hersteller-Feld.
 * Diese Datei ist die Single Source of Truth für die Hersteller-Dimension
 * und wird sowohl vom Frontend (Models-Seite) als auch vom Server
 * (timeseries groupBy=manufacturer) importiert.
 */

const RULES: Array<[pattern: string, manufacturer: string]> = [
  // Reihenfolge: spezifischere Patterns zuerst
  ["minimax", "MiniMax"],
  ["deepseek", "DeepSeek"],
  ["qwen", "Alibaba"],
  ["glm", "Zhipu AI"],
  ["kimi", "Moonshot AI"],
  ["mimo", "Xiaomi"],
  ["hy", "Tencent"], // Hunyuan (hy3, hy3-free) — nach "minimax" etc. prüfen
  ["ling", "InclusionAI"],
  ["longcat", "Meituan"],
  ["gemma", "Google"],
  ["gpt", "OpenAI"],
  ["laguna", "Poolside"],
];

const OTHER = "Other";

/** Normalisiert Provider-Pfade wie "qwen/qwen3.6-27b" oder "deepseek-ai/…" weg. */
export function normalizeModelId(modelId: string): string {
  const slash = modelId.lastIndexOf("/");
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

/** Hersteller zu einer model_id bestimmen ("Other" als Fallback). */
export function detectManufacturer(modelId: string): string {
  const id = normalizeModelId(modelId).toLowerCase();
  for (const [pattern, manufacturer] of RULES) {
    if (id.includes(pattern)) return manufacturer;
  }
  return OTHER;
}
