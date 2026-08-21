/**
 * Client-side helpers for the global period filter (the drill-down you get by
 * clicking a bar in the trend chart). A period is identified by its bucket
 * *start* date plus the *unit* (day | week | month). `periodRange` expands that
 * into an explicit `from`/`to` window that the API understands, mirroring the
 * server's `bucketDay()` Monday-boundary logic so the two never disagree.
 */

export type PeriodUnit = "day" | "week" | "month";

export interface PeriodRange {
  from: string; // YYYY-MM-DD, local time
  to: string; // YYYY-MM-DD, local time
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function periodRange(start: string, unit: PeriodUnit): PeriodRange {
  if (unit === "day") return { from: start, to: start };
  const d = new Date(`${start}T00:00:00`);
  if (unit === "month") {
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: ymd(first), to: ymd(last) };
  }
  // week: Monday .. Sunday of the week containing `start`
  const sinceMonday = (d.getDay() + 6) % 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - sinceMonday);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}

/** Human-readable label for a period, e.g. "18. Aug – 24. Aug 2026" (de). */
export function formatPeriodLabel(
  start: string,
  unit: PeriodUnit,
  loc: string,
): string {
  if (unit === "day") {
    return new Intl.DateTimeFormat(loc, { dateStyle: "medium" }).format(
      new Date(`${start}T00:00:00`),
    );
  }
  const { from, to } = periodRange(start, unit);
  const fmt = (d: string) =>
    new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short" }).format(
      new Date(`${d}T00:00:00`),
    );
  const year = new Intl.DateTimeFormat(loc, { year: "numeric" }).format(
    new Date(`${to}T00:00:00`),
  );
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth ? `${fmt(from)} – ${fmt(to)} ${year}` : `${fmt(from)} – ${fmt(to)}`;
}

