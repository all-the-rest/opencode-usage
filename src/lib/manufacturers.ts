/**
 * Statische Zuordnung Modell → Hersteller (Company/Org).
 *
 * models.dev liefert nur family-Slugs (z.B. "Hy"), aber kein Hersteller-Feld.
 * Diese Datei ist die Single Source of Truth für die Hersteller-Dimension
 * und wird sowohl vom Frontend (Models-Seite) als auch vom Server
 * (timeseries groupBy=manufacturer) importiert.
 */

import MANUAL_RULES, {
  compileRules,
  matchManualManufacturer,
  STEALTH_MANUFACTURER,
  type ManualRule,
} from "./manual-manufacturers";

export { STEALTH_MANUFACTURER };

const RULES: ManualRule[] = [
  // Reihenfolge: spezifischere Patterns zuerst
  // Stealth-/Manuell-Zuordnungen ZUERST (siehe manual-manufacturers.ts —
  // dort neue Stealth-Modelle eintragen!)
  ...MANUAL_RULES,
  ["minimax", "MiniMax"],
  ["deepseek", "DeepSeek"],
  ["qwen", "Alibaba"],
  ["glm", "Z.ai"],
  ["kimi", "Moonshot AI"],
  ["mimo", "Xiaomi"],
  // Hunyuan: nur als eigenständiges Token, nicht als blindes Substring —
  // sonst träfe „hy" auch IDs wie „phyto“/„hydrogen“. `[\d.]*` lässt die
  // Versionsnummer zu (hy3, hy3-free).
  ["(^|[-_./])hy[\\d.]*($|[-_])", "Tencent"],
  // InclusionAI: beide Linien als Token verankert — ein blindes „ling"
  // traf auch thinkingmachines/Inkling* (fälschlich InclusionAI).
  ["(^|[-_./])ling([\\d.]*)?($|[-_:])", "InclusionAI"],
  ["(^|[-_./])ring([\\d.]*)?($|[-_:])", "InclusionAI"], // Ring 1T/2.6 (incl. ring-2.6-1t-free)
  ["longcat", "Meituan"],
  ["gemma", "Google"],
  ["gemini", "Google"],
  ["claude", "Anthropic"],
  // nemotron VOR llama: die Nemotron-Modelle sind auf Llama gebaut
  // (nvidia/Llama-3.3-Nemotron-…), der komplette Name gehört trotzdem
  // zu NVIDIA — „llama" zuerst würde den eigentlichen Hersteller überschreiben.
  ["nemotron", "NVIDIA"],
  ["llama", "Meta"], // Meta
  ["muse", "Meta"], // Muse Spark 1.x + Muse Glimmer (z.T. Contributor-Tier)
  ["mistral|ministral|magistral", "Mistral"],
  ["(^|[-_./])step[\\d.]*($|[-_])", "StepFun"], // Step 3 Flash & Co.
  ["grok", "xAI"],
  ["trinity", "Arcee AI"], // Trinity Large (nicht stealth — Labor bekannt)
  // OpenAI: „gpt" plus die o-Serie, die kein „gpt" im Namen trägt
  // (o3/o4-mini …). Token-verankert, damit „o200k“ & Co. nicht trifft.
  ["(^|[-_./])o[134]([\\d.]*)?($|[-_:])", "OpenAI"],
  ["gpt", "OpenAI"],
  ["laguna", "Poolside"],
  ["north-mini", "Cohere"], // North Mini Code (Cohere)
  ["bonsai", "Prism ML"],
];

/** Vorkompiliert — die Regeln werden pro Modell durchlaufen. */
const COMPILED_RULES = compileRules(RULES);

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
  // Handregeln (Stealth, Ex-Stealth) haben Vorrang vor den generischen.
  const manual = matchManualManufacturer(id);
  if (manual) return manual;
  for (const [re, manufacturer] of COMPILED_RULES) {
    if (re.test(id)) return manufacturer;
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
