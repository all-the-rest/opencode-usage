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
  ["x-preview-f", STEALTH_MANUFACTURER], // Ox Alpha (Free) — Stealth-Preview
];

export default MANUAL_RULES;
