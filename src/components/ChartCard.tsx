/**
 * Card shell for a chart: a titled surface with a fixed-height body. The chart
 * itself (wrapped in a Recharts <ResponsiveContainer>) is passed as `children`
 * by the caller, so the ResponsiveContainer's direct child is always the chart
 * (required for correct sizing).
 *
 * When `empty` is set, the body collapses to a compact centered area instead of
 * reserving the full chart height — used to keep empty-state cards small.
 */

import type { ReactNode } from "react";

export function ChartCard({
  title,
  height = 300,
  children,
  right,
  empty = false,
}: {
  title: string;
  height?: number;
  children: ReactNode;
  right?: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body gap-2">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="card-title text-base">{title}</h2>
          {right}
        </div>
        {empty ? (
          <div className="flex min-h-[72px] items-center justify-center px-4 text-center">
            {children}
          </div>
        ) : (
          <div style={{ width: "100%", height }}>{children}</div>
        )}
      </div>
    </div>
  );
}
