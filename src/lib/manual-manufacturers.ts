/**
 * Manuelle Modell-Hersteller-Zuordnung — HIER PFLEGEN!
 *
 * Stealth-Modelle (z.B. OpenCode Zen Free-Modelle mit unbekanntem Lab) und
 * Sonderfälle, die models.dev / die Heuristik nicht zuordnen kann, stehen
 * hier. Eine Zeile pro Modell-Pattern (case-insensitive Substring-Match auf
 * die model_id, ohne Provider-Pfad).
 *
 * Bevor ein neues Stealth-Modell auftaucht: einfach eine Zeile ergänzen,
 * z.B.  ["trinity-large", "OpenCode Stealth"]
 */

const MANUAL_RULES: Array<[pattern: string, manufacturer: string]> = [
  ["big-pickle", "OpenCode Stealth"], // Stealth-Modell, Lab unbekannt
  ["x-preview-f", "OpenCode Stealth"], // Stealth-Preview
];

export default MANUAL_RULES;
