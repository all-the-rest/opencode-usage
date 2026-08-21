/**
 * Number / date formatting helpers shared across the dashboard pages.
 *
 * Conventions (per task brief):
 *  - Tokens: compact, e.g. 66_100_000 -> "66.1M", 1_610_000_000 -> "1.61B"
 *  - Cost:   "$" with two decimals, e.g. 12.5 -> "$12.50"
 *  - Ratio:  input is a fraction in [0,1], rendered as "x.x%"
 */

import type { Lang } from "./i18n";

/** Compact token formatting: K / M / B suffixes. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return trim(n / 1e9) + "B";
  if (abs >= 1e6) return trim(n / 1e6) + "M";
  if (abs >= 1e3) return trim(n / 1e3) + "K";
  return String(Math.round(n));
}

function trim(x: number): string {
  // 1.61 -> "1.61", 66.10 -> "66.1", 2.00 -> "2"
  return x
    .toFixed(2)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

/** Cost as a dollar amount with two decimals. */
export function formatCost(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return "$" + n.toFixed(2);
}

/** Ratio in [0,1] rendered as a percentage with one decimal. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0%";
  return (ratio * 100).toFixed(1) + "%";
}

/** Thousands-separated integer (for plain table cells). */
export function formatInt(n: number, lang: Lang): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US").format(
    Math.round(n),
  );
}

const LOCALE: Record<Lang, string> = { de: "de-DE", en: "en-US" };

/** Medium date (no time). Returns an em dash for null. */
export function formatDate(ms: number | null, lang: Lang): string {
  if (ms == null) return "—";
  return new Intl.DateTimeFormat(LOCALE[lang], {
    dateStyle: "medium",
  }).format(new Date(ms));
}

/**
 * Human relative time using Intl.RelativeTimeFormat, e.g. "vor 3 Tagen" /
 * "3 days ago". Falls back to an em dash for null.
 */
export function formatRelative(ms: number | null, lang: Lang): string {
  if (ms == null) return "—";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(LOCALE[lang], { numeric: "auto" });
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const MONTH = DAY * 30;
  const YEAR = DAY * 365;
  if (abs < MIN) return rtf.format(0, "second");
  if (abs < HOUR) return rtf.format(Math.round(diff / MIN), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < MONTH) return rtf.format(Math.round(diff / DAY), "day");
  if (abs < YEAR) return rtf.format(Math.round(diff / MONTH), "month");
  return rtf.format(Math.round(diff / YEAR), "year");
}

/** Short day tick for charts: "YYYY-MM-DD" -> "MM-DD". */
export function shortDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day;
}

/** Short month tick for charts: "YYYY-MM-DD" -> "YYYY-MM". */
export function shortMonth(day: string): string {
  return day.slice(0, 7);
}

/** Basename of a path ("/a/b/c" -> "c"). */
export function basename(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}
