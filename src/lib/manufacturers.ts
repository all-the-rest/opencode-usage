/**
 * Statische Zuordnung Modell → Hersteller (Company/Org).
 *
 * models.dev liefert nur family-Slugs (z.B. "Hy"), aber kein Hersteller-Feld.
 * Diese Datei ist die Single Source of Truth für die Hersteller-Dimension
 * und wird sowohl vom Frontend (Models-Seite) als auch vom Server
 * (timeseries groupBy=manufacturer) importiert.
 */

import MANUAL_RULES, { STEALTH_MANUFACTURER } from "./manual-manufacturers";

export { STEALTH_MANUFACTURER };

const RULES: Array<[pattern: string, manufacturer: string]> = [
  // Reihenfolge: spezifischere Patterns zuerst
  // Stealth-/Manuell-Zuordnungen ZUERST (siehe manual-manufacturers.ts —
  // dort neue Stealth-Modelle eintragen!)
  ...MANUAL_RULES,
  ["minimax", "MiniMax"],
  ["deepseek", "DeepSeek"],
  ["qwen", "Alibaba"],
  ["glm", "Zhipu AI"],
  ["kimi", "Moonshot AI"],
  ["mimo", "Xiaomi"],
  ["hy", "Tencent"], // Hunyuan (hy3, hy3-free)
  ["ling", "InclusionAI"],
  ["longcat", "Meituan"],
  ["gemma", "Google"],
  ["gpt", "OpenAI"],
  ["laguna", "Poolside"],
  ["muse-spark", "Meta"], // Muse Spark 1.x (Meta, z.T. Contributor-Tier)
  ["north-mini", "Cohere"], // North Mini Code (Cohere)
  ["bonsai", "Prism ML"],
];

/** Kanonischer Schlüssel für nicht identifizierte Hersteller. */
export const OTHER_MANUFACTURER = "Other";

/** Normalisiert Provider-Pfade wie "qwen/qwen3.6-27b" oder "deepseek-ai/…" weg. */
export function normalizeModelId(modelId: string): string {
  const slash = modelId.lastIndexOf("/");
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

/** Hersteller zu einer model_id bestimmen (OTHER_MANUFACTURER als Fallback). */
export function detectManufacturer(modelId: string): string {
  const id = normalizeModelId(modelId).toLowerCase();
  for (const [pattern, manufacturer] of RULES) {
    if (id.includes(pattern)) return manufacturer;
  }
  return OTHER_MANUFACTURER;
}

/**
 * Stealth-Modelle (Hersteller = STEALTH_MANUFACTURER) sind standalone:
 * kein abgeleiteter Family-Slug — als Family gilt der Hersteller-Name selbst.
 */
export function isStealthModel(modelId: string): boolean {
  return detectManufacturer(modelId) === STEALTH_MANUFACTURER;
}
