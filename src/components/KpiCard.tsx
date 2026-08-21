/**
 * Compact KPI stat card used in the dashboard's top row.
 */

import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="stat bg-base-200 rounded-box shadow-sm">
      <div className="stat-title">{label}</div>
      <div className="stat-value text-2xl">{value}</div>
      {hint != null && <div className="stat-desc">{hint}</div>}
    </div>
  );
}
