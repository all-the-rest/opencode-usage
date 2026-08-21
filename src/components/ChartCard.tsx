/**
 * Card shell for a chart: a titled surface with a fixed-height body. The chart
 * itself (wrapped in a Recharts <ResponsiveContainer>) is passed as `children`
 * by the caller, so the ResponsiveContainer's direct child is always the chart
 * (required for correct sizing).
 */

import type { ReactNode } from "react";

export function ChartCard({
  title,
  height = 300,
  children,
  right,
}: {
  title: string;
  height?: number;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="card-title text-base">{title}</h2>
          {right}
        </div>
        <div style={{ width: "100%", height }}>{children}</div>
      </div>
    </div>
  );
}
