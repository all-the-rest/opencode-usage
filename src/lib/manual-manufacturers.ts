/**
 * Manuelle Modell-Hersteller-Zuordnung — HIER PFLEGEN!
 *
 * Stealth-Modelle (z.B. OpenCode Zen Free-Modelle mit unbekanntem Lab) und
 * Sonderfälle, die models.dev / die Heuristik nicht zuordnen kann, stehen
 * hier. Eine Zeile pro Modell-Pattern (case-insensitive, auf die model_id
 * ohne Provider-Pfad).
 *
 * Stealth-Modelle sind "standalone": ihr Anzeigename ist eigenständig
 * (z.b. omen-alpha → Katalogname ohne Klammer-Zusatz), sie teilen sich EINEN
 * Hersteller (STEALTH_MANUFACTURER) und bekommen genau diesen auch als
 * Family — die Heuristik (familyKey/resolveModelMeta) liefert für sie keinen
 * eigenen Slug.
 *
 * Ex-Stealth-Modelle mit gelüfteter Identität (z.B. ox-alpha = GLM-5.3-Flash,
 * Z.ai) stehen NICHT mehr hier unter STEALTH, sondern mit ihrem echten
 * Hersteller in MANUAL_RULES und mit ihrer echten Family in
 * MANUAL_FAMILY_RULES weiter unten.
 *
 * Bevor ein neues Stealth-Modell auftaucht: einfach eine Zeile ergänzen,
 * z.B.  ["trinity-large", STEALTH_MANUFACTURER]
 */

/** Gemeinsamer Hersteller UND Family-Name aller Stealth-Modelle. */
export const STEALTH_MANUFACTURER = "OpenCode Stealth";

/**
 * Eine Handregel: Pattern → Wert. Erste passende Regel gewinnt.
 *
 * Das Pattern ist eine **Regex-Quelle** (case-insensitive, unanchored — ein
 * einfaches `"mimo"` verhält sich exakt wie die frühere Substring-Suche).
 * Der entscheidende Vorteil gegenüber Substrings: Versionen müssen nicht
 * einzeln aufgeführt werden, ein Versions-Upgrade fällt damit automatisch
 * durch dieselbe Regel.
 *
 *   ["deepseek-v[\\d.]+-pro", …]  →  deepseek-v4-pro, -v4.1-pro, -v5-pro, …
 *
 * Mit `^…$` anchorrt man auf eine exakte ID. Ein syntaktisch kaputtes
 * Pattern führt nicht zum Crash, sondern wird als Literal-Substring
 * behandelt.
 */
export type ManualRule = [pattern: string, value: string];

/** Regeln einmalig kompilieren — nicht pro Modell neu. */
export function compileRules(
  rules: readonly ManualRule[],
): Array<[RegExp, string]> {
  return rules.map(([pattern, value]) => {
    try {
      return [new RegExp(pattern, "i"), value];
    } catch {
      const literal = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return [new RegExp(literal, "i"), value];
    }
  });
}

/** Erster Wert, dessen Pattern auf `id` passt, sonst null. */
export function matchRules(
  compiled: ReadonlyArray<[RegExp, string]>,
  id: string,
): string | null {
  for (const [re, value] of compiled) {
    if (re.test(id)) return value;
  }
  return null;
}

const MANUAL_RULES: ManualRule[] = [
  ["big-pickle", STEALTH_MANUFACTURER], // Stealth-Modell, Lab unbekannt
  // Ox Alpha Free — EX-Stealth: am 2026-08-26 von Z.ai als GLM-5.3-Flash
  // bestätigt. Dasselbe Modell unter zwei Provider-IDs:
  // opencode = x-preview-f-free, opencode-go = ox-alpha-free.
  // Enthält kein „glm“, braucht daher explizite Regeln (statt der
  // glm-Heuristik in manufacturers.ts).
  ["x-preview-f", "Z.ai"],
  ["ox-alpha", "Z.ai"],
  // Omen Alpha — neues Stealth-Modell (opencode-go/omen-alpha), Lab unbekannt.
  ["omen-alpha", STEALTH_MANUFACTURER],
  // Union Alpha — neues Stealth-Modell (opencode/union-alpha,
  // opencode-go/union-alpha), Lab unbekannt.
  ["union-alpha", STEALTH_MANUFACTURER],
  // Space Bunny — OpenCode-Free-Modell (opencode/space-bunny-free UND
  // opencode-go/space-bunny-free; als „stealth/space-bunny-alpha" auch bei
  // nano-gpt/kilo/openrouter). Ein Pattern deckt beide Namensvarianten ab.
  // Stand 2026-09-26: Lab UNBESTÄTIGT, Verdacht auf MiniMax 3.1 Flash — der
  // Katalog liefert für das Modell bewusst KEINE family. Sobald das Lab
  // bestätigt ist, diese Zeile durch ["space-bunny", "MiniMax"] ersetzen
  // (die generische ["minimax", …]-Regel in manufacturers.ts greift dann von
  // selbst, sobald die ID das Lab nennt).
  ["space-bunny", STEALTH_MANUFACTURER],
];

export default MANUAL_RULES;

/** Vorkompilierte Hersteller-Regeln (siehe compileRules). */
export const COMPILED_MANUAL_RULES = compileRules(MANUAL_RULES);

/** Hersteller aus den Handregeln, sonst null (siehe detectManufacturer). */
export function matchManualManufacturer(id: string): string | null {
  return matchRules(COMPILED_MANUAL_RULES, id);
}

/**
 * Kuratierte Family-Overrides — korrigieren inkonsistente/falsche
 * Family-Slugs aus dem Katalog (models.dev) und haben VORRANG vor Katalog
 * UND ID-Heuristik (siehe catalogFamily in server/metadata.ts).
 *
 * Pattern = Regex-Quelle wie oben; erste passende Regel gewinnt — daher
 * immer die SPEZIFISCHE Regel vor die allgemeine Linien-Regel schreiben.
 *
 * Grundsatz: Family = MODELL-LINIE, nicht Version. Den Hersteller trägt
 * ohnehin die eigene Dimension (detectManufacturer). Ein Tier ist nur dann
 * eine eigene Family, wenn es ein echtes Upgrade ist („-pro") und nicht
 * bloß eine Variante derselben Linie — die Qwen-Tiers (max/plus/flash)
 * sind dagegen je eine eigene Family.
 */
export const MANUAL_FAMILY_RULES: ManualRule[] = [
  // --- DeepSeek: zwei Tiers, eine Linie -----------------------------------
  // „pro" ist das große/teure Tier ($0.66/$1.98 pro 1M bei opencode-go vs.
  // $0.15/$0.60 für flash — bei opencode sogar 12×/14×) und bekommt daher
  // einen EIGENEN Bucket. Der Katalog sortiert es als `deepseek-thinking`
  // (Slug der Reasoning-Linie, in der auch die ganze R1-Familie liegt) und
  // ist sich selbst uneinig: 32 IDs sagen `deepseek-thinking`, 3 sagen
  // `deepseek`, 1 sagt null.
  // `[\d.]+` statt einer festen Version: v4-pro, v4.1-pro, v5-pro … landen
  // automatisch im selben Bucket, ohne neue Regel pro Release.
  ["deepseek-v[\\d.]+-pro", "deepseek-pro"],
  // Alles Übrige (v4-flash, v4.1-flash, -free, -vision-exp, …) ist EINE
  // Linie „deepseek" — der Katalog splittet hier unnötig in
  // „deepseek-flash" und „deepseek".
  ["deepseek", "deepseek"],

  // --- MiMo (Xiaomi): V2/V2.5/V2.6 als Flash-Basis plus PRO-Tier -----------
  // Katalog ist hier besonders unsauber: für ein und dasselbe Modell liefert
  // er „mimo", „mimo-v2.5", „mimo-v2.5-pro", „mimo-v2-pro", „mimo-pro-free",
  // „mimo-flash-free" und „mimo-omni-free" — je nach Provider. Die Versions-
  // nummer gehört NICHT in die Family (V2.5 und V2.6 sind dieselbe Linie),
  // das PRO-Tier schon (eigener Bucket).
  ["mimo-v[\\d.]+-pro", "mimo-pro"],
  ["mimo", "mimo"],

  // --- Qwen (Alibaba): Tiers sind Families, Versionen nicht ---------------
  // Beim Qwen-Schnitt gehört die TIER-Bezeichnung in die Family (die drei
  // Tiers max/plus/flash sind getrennt zu sehen), die Versionsnummer aber
  // NICHT: der Katalog liefert qwen3.7-max und qwen3.8-max als zwei eigene
  // Families — für dasselbe Tier. `[\d.]+` schiebt die Version weg und
  // fängt qwen3.8/qwen4/qwen4.1 gleich mit ab; qwen3.8-flash landete per
  // Katalog sonst bloß auf „qwen".
  ["qwen[\\d.]+-flash", "qwen-flash"],
  ["qwen[\\d.]+-max", "qwen-max"],
  ["qwen[\\d.]+-plus", "qwen-plus"],
  ["qwen[\\d.]+-pro", "qwen-pro"],
  ["qwen", "qwen"],

  // Muse Spark Contributor & -Free: Katalog sagt fälschlich „muse-free“.
  ["muse", "muse"],
  // Kimi/MiniMax: der Katalog pinnt die Version („kimi-k2“, „minimax-m3“) —
  // bei Kimi K3 bzw. MiniMax M4 entstünde ein zweiter Phantom-Bucket.
  // Gleiches Muster wie bei DeepSeek, wo v4-flash und v4.1-flash EINE
  // Family „deepseek“ bilden. Tier-Unterschiede (falls eine Linie welche
  // bekommt) hier bewusst noch nicht gesplittet — erst wenn es welche gibt.
  ["kimi", "kimi"],
  ["minimax", "minimax"],
  // North Mini Code: der Katalog-Slug „north-free“ zieht die Tier-Endung in
  // die Family. Der Katalog sagt selbst überall „north“ (Cohere/north-mini-
  // code-1-0, …); kein anderes Modell enthält „north“ → breites Muster
  // gefährlichkeitsfrei.
  ["north", "north"],
  // hy3 / hy3-free: Katalog splittet „Hy“ vs. „hy3-free“ → eine Family.
  ["hy3", "hy"],
  // Ling-3.0-Familie (Zen -free-Varianten sagen „ling“, OpenRouter
  // inclusionai/ling-3.0-flash:free fälschlich „ling-flash“).
  ["ling-3[.]0", "ling"],
  // Alle Gemma-Varianten (QAT-Größen, -IT, lokal wie remote) sind EINE
  // Family „gemma" — der Katalog splittet „gemma-it-qat"/„gemma-qat“.
  ["gemma", "gemma"],
  // Alle LongCat-Varianten (2.0, 2.5-preview, -free, -thinking, local wie
  // remote) sind EINE Family „longcat" (Meituan). Nötig, weil neue Versionen
  // (Stand 2026-09-26: longcat-2.5-preview-free) dem Katalog noch fehlen und
  // die ID-Heuristik dann „longcat-preview" liefern würde — ein zweiter,
  // Phantom-Bucket.
  ["longcat", "longcat"],
  // Ox Alpha (ex-Stealth = GLM-5.3-Flash) in denselben Family-Bucket wie die
  // enthüllte ID glm-5.3-flash (Heuristik: „glm-flash“) — sonst fiele
  // ox-alpha-free via Katalog-Fallback auf „alpha“ (stealth/ox-alpha-Einträge
  // fremder Provider) bzw. auf die Heuristik „ox-alpha“.
  ["ox-alpha", "glm-flash"],
  ["x-preview-f", "glm-flash"],
];

/** Vorkompilierte Family-Regeln (siehe compileRules). */
export const COMPILED_FAMILY_RULES = compileRules(MANUAL_FAMILY_RULES);

/** Family aus den Handregeln, sonst null (siehe catalogFamily). */
export function matchManualFamily(id: string): string | null {
  return matchRules(COMPILED_FAMILY_RULES, id);
}
