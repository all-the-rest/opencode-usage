/**
 * Manuelle Modell-Hersteller-Zuordnung — HIER PFLEGEN!
 *
 * Stealth-Modelle (z.B. OpenCode Zen Free-Modelle mit unbekanntem Lab) und
 * Sonderfälle, die models.dev / die Heuristik nicht zuordnen kann, stehen
 * hier. Eine Zeile pro Modell-Pattern (case-insensitive Substring-Match auf
 * die model_id, ohne Provider-Pfad).
 *
 * Stealth-Modelle sind "standalone": ihr Anzeigename ist eigenständig
 * (z.B. x-preview-f-free → „Ox Alpha Free“), sie teilen sich EINEN Hersteller
 * (STEALTH_MANUFACTURER) und bekommen genau diesen auch als Family — die
 * Heuristik (familyKey/resolveModelMeta) liefert für sie keinen eigenen Slug.
 *
 * Bevor ein neues Stealth-Modell auftaucht: einfach eine Zeile ergänzen,
 * z.B.  ["trinity-large", STEALTH_MANUFACTURER]
 */

/** Gemeinsamer Hersteller UND Family-Name aller Stealth-Modelle. */
export const STEALTH_MANUFACTURER = "OpenCode Stealth";

const MANUAL_RULES: Array<[pattern: string, manufacturer: string]> = [
  ["big-pickle", STEALTH_MANUFACTURER], // Stealth-Modell, Lab unbekannt
  // Ox Alpha Free — dasselbe Stealth-Modell unter zwei Provider-IDs:
  // opencode = x-preview-f-free, opencode-go = ox-alpha-free.
  ["x-preview-f", STEALTH_MANUFACTURER],
  ["ox-alpha", STEALTH_MANUFACTURER],
];

export default MANUAL_RULES;

/**
 * Kuratierte Family-Overrides — korrigieren inkonsistente/falsche
 * Family-Slugs aus dem Katalog (models.dev) und haben VORRANG vor Katalog
 * UND ID-Heuristik (siehe catalogFamily in server/metadata.ts).
 *
 * Substring-Match auf die normalisierte model_id (ohne Provider-Pfad,
 * case-insensitive); erste Regel, deren Pattern passt, gewinnt.
 */
export const MANUAL_FAMILY_RULES: Array<[pattern: string, family: string]> = [
  // Alle MiMo-Varianten (v2/v2.5, ±pro, ±free) sind eine Family „mimo“ —
  // der Katalog splittet fälschlich in „mimo-v2.5“, „mimo-v2.5-pro-free“ etc.
  ["mimo", "mimo"],
  // Muse Spark Contributor & -Free: Katalog sagt fälschlich „muse-free“.
  ["muse", "muse"],
  // hy3 / hy3-free: Katalog splittet „Hy“ vs. „hy3-free“ → eine Family.
  ["hy3", "hy"],
  // Ling-3.0-Familie (Zen -free-Varianten sagen „ling“, OpenRouter
  // inclusionai/ling-3.0-flash:free fälschlich „ling-flash“).
  ["ling-3.0", "ling"],
  // Alle Gemma-Varianten (QAT-Größen, -IT, lokal wie remote) sind EINE
  // Family „gemma“ — der Katalog splittet „gemma-it-qat“/„gemma-qat“.
  ["gemma", "gemma"],
];
