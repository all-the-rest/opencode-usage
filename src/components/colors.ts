/**
 * Shared color palette for Recharts series. Theme-aware CSS variables are used
 * for the first entries (so light/dark both look right); the final entry is a
 * neutral gray reserved for aggregated "Other" buckets.
 */

export const CHART_PALETTE: string[] = [
  "var(--color-primary)",
  "var(--color-secondary)",
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-error)",
  "#7c3aed",
  "#0d9488",
  "#9ca3af", // "Other" / neutral
];

/** Stable color for series index `i`. */
export function paletteColor(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length] ?? "#9ca3af";
}
