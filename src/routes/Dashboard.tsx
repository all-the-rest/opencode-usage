/**
 * Dashboard ("/")
 *  - KPI row from getSummary()
 *  - Stacked token-trend AreaChart from getTimeseries() (granularity + groupBy switches)
 *  - Cost-trend LineChart from getTimeseries()
 *  - Activity heatmap from getHeatmap() (rows = hours 0-23, columns = weeks)
 *
 * All data hooks use usePoll (60s auto-refresh) and surface loading / error /
 * retry states through the shared components.
 */

import { Fragment, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getHeatmap,
  getSummary,
  getTimeseries,
  usePoll,
} from "../lib/api";
import type { Granularity, GroupBy, HeatmapCell, TimeseriesPoint } from "../lib/types";
import {
  formatCost,
  formatDate,
  formatDayMonth,
  formatInt,
  formatRatio,
  formatTokens,
  shortDay,
  shortMonth,
} from "../lib/format";
import { t, useLang, type Lang } from "../lib/i18n";
import { AsyncState, EmptyState, ErrorState, Spinner } from "../components/Async";
import { ChartCard } from "../components/ChartCard";
import { KpiCard } from "../components/KpiCard";
import { paletteColor } from "../components/colors";

const TOKEN_FIELDS = [
  { field: "inputTokens", key: "input", labelKey: "tokInput" },
  { field: "outputTokens", key: "output", labelKey: "tokOutput" },
  { field: "reasoningTokens", key: "reasoning", labelKey: "tokReasoning" },
  { field: "cacheReadTokens", key: "cacheRead", labelKey: "tokCacheRead" },
] as const;

type Row = Record<string, number | string>;

export default function Dashboard() {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [groupBy, setGroupBy] = useState<GroupBy>("total");

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("routeDashboard")}</h1>

      <SummaryKpis />

      <TokenTrendChart
        key={`${granularity}-${groupBy}`}
        granularity={granularity}
        groupBy={groupBy}
        onGranularity={setGranularity}
        onGroupBy={setGroupBy}
      />

      <CostTrendChart key={granularity} granularity={granularity} />

      <TokenShareChart />

      <HeatmapCard />
    </div>
  );
}

function SummaryKpis() {
  const summary = usePoll(getSummary);
  const lang = useLang();

  if (summary.loading && !summary.data) return <Spinner />;
  if (summary.error && !summary.data)
    return <ErrorState error={summary.error} onRetry={summary.refetch} />;
  const s = summary.data;
  if (!s) return <p className="text-base-content/60">{t("stateNoData")}</p>;

  const f = s.firstMessageAt;
  const l = s.lastMessageAt;
  let periodValue = "—";
  let periodHint: string | undefined;
  if (f != null && l != null) {
    periodValue = `${formatDayMonth(f, lang)}–${formatDayMonth(l, lang)}`;
    periodHint = `${t("kpiFrom", { from: formatDate(f, lang) })} · ${t(
      "kpiTo",
      { to: formatDate(l, lang) },
    )}`;
  } else if (f != null || l != null) {
    periodValue = formatDate(f ?? l, lang);
    periodHint = `${t("kpiFrom", { from: formatDate(f, lang) })} · ${t(
      "kpiTo",
      { to: formatDate(l, lang) },
    )}`;
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard label={t("kpiTotalTokens")} value={formatTokens(s.totalTokens)} />
      <KpiCard label={t("kpiCost")} value={formatCost(s.totalCost)} />
      <KpiCard label={t("kpiSessions")} value={formatInt(s.sessionCount, lang)} />
      <KpiCard label={t("kpiMessages")} value={formatInt(s.messageCount, lang)} />
      <KpiCard
        label={t("kpiCacheHitRatio")}
        value={formatRatio(s.avgCacheHitRatio)}
      />
      <KpiCard label={t("kpiPeriod")} value={periodValue} hint={periodHint} />
    </div>
  );
}

function GranularitySwitch({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  const opts: Granularity[] = ["day", "week", "month"];
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm opacity-70">{t("granularity")}</span>
      <div className="join">
        {opts.map((g) => (
          <button
            key={g}
            className={`btn btn-xs join-item ${value === g ? "btn-primary" : ""}`}
            onClick={() => onChange(g)}
          >
            {t(g === "day" ? "granDay" : g === "week" ? "granWeek" : "granMonth")}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupBySwitch({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (g: GroupBy) => void;
}) {
  const opts: GroupBy[] = ["total", "provider", "family"];
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm opacity-70">{t("groupBy")}</span>
      <div className="join">
        {opts.map((g) => (
          <button
            key={g}
            className={`btn btn-xs join-item ${value === g ? "btn-primary" : ""}`}
            onClick={() => onChange(g)}
          >
            {t(
              g === "total"
                ? "groupTotal"
                : g === "provider"
                  ? "groupProvider"
                  : "groupFamily",
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function buildTokenRows(
  points: TimeseriesPoint[],
  groupBy: GroupBy,
): { rows: Row[]; series: { key: string; label: string }[] } {
  if (groupBy === "total") {
    const byDay = new Map<string, Row>();
    for (const p of points) {
      const row = byDay.get(p.day) ?? { day: p.day };
      for (const f of TOKEN_FIELDS) {
        row[f.key] = ((row[f.key] as number) ?? 0) + (p[f.field] as number);
      }
      byDay.set(p.day, row);
    }
    return {
      rows: [...byDay.values()],
      series: TOKEN_FIELDS.map((f) => ({ key: f.key, label: t(f.labelKey) })),
    };
  }

  // provider / family / model: top 8 keys by total tokens + "Other"
  const totals = new Map<string, number>();
  for (const p of points) {
    const total =
      p.inputTokens + p.outputTokens + p.reasoningTokens + p.cacheReadTokens;
    totals.set(p.key, (totals.get(p.key) ?? 0) + total);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 8).map(([k]) => k);
  const topSet = new Set(top);

  const byDay = new Map<string, Row>();
  for (const p of points) {
    const row = byDay.get(p.day) ?? { day: p.day };
    const bucket = topSet.has(p.key) ? p.key : "Other";
    const total =
      p.inputTokens + p.outputTokens + p.reasoningTokens + p.cacheReadTokens;
    row[bucket] = ((row[bucket] as number) ?? 0) + total;
    byDay.set(p.day, row);
  }

  const series = [
    ...top.map((k) => ({ key: k, label: k })),
    ...(ranked.length > top.length
      ? [{ key: "Other", label: t("seriesOther") }]
      : []),
  ];
  return { rows: [...byDay.values()], series };
}

function TokenTrendChart({
  granularity,
  groupBy,
  onGranularity,
  onGroupBy,
}: {
  granularity: Granularity;
  groupBy: GroupBy;
  onGranularity: (g: Granularity) => void;
  onGroupBy: (g: GroupBy) => void;
}) {
  const api = usePoll((signal) => getTimeseries(granularity, groupBy, signal));
  const tickFmt = (day: string) =>
    granularity === "day" ? shortDay(day) : shortMonth(day);

  return (
    <ChartCard
      title={t("chartTokenTrend")}
      height={340}
      right={
        <div className="flex flex-wrap items-center gap-3">
          <GranularitySwitch value={granularity} onChange={onGranularity} />
          <GroupBySwitch value={groupBy} onChange={onGroupBy} />
        </div>
      }
      empty={(api.data?.points?.length ?? 0) === 0}
    >
      <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
        {(() => {
          const pts = api.data?.points ?? [];
          if (pts.length === 0) return <EmptyState />;
          const { rows, series } = buildTokenRows(pts, groupBy);
          return (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-base-300" />
              <XAxis
                dataKey="day"
                tickFormatter={tickFmt}
                fontSize={11}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v) => formatTokens(Number(v))}
                fontSize={11}
                width={48}
              />
              <Tooltip content={<TokenTrendTooltip />} />
              <Legend wrapperStyle={{ flexWrap: "wrap" }} />
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stackId="1"
                  fill={paletteColor(i)}
                  stroke={paletteColor(i)}
                  fillOpacity={0.7}
                />
              ))}
              </AreaChart>
            </ResponsiveContainer>
          );
        })()}
      </AsyncState>
    </ChartCard>
  );
}

/** Custom tooltip for the stacked token trend: per-series values + day total. */
function TokenTrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, e: any) => s + (Number(e.value) || 0), 0);
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2 text-xs shadow">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((e: any) => (
        <div key={e.dataKey} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: e.color }}
          />
          <span>{e.name}:</span>
          <span>{formatTokens(Number(e.value) || 0)}</span>
        </div>
      ))}
      <div className="mt-1 border-t border-base-300 pt-1 font-medium">
        {t("cardTotal")}: {formatTokens(total)}
      </div>
    </div>
  );
}

function CostTrendChart({ granularity }: { granularity: Granularity }) {
  const api = usePoll((signal) => getTimeseries(granularity, "total", signal));
  const tickFmt = (day: string) =>
    granularity === "day" ? shortDay(day) : shortMonth(day);

  return (
    <ChartCard
      title={t("chartCostTrend")}
      height={260}
      empty={(api.data?.points?.length ?? 0) === 0}
    >
      <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
        {(() => {
          const pts = api.data?.points ?? [];
          if (pts.length === 0) return <EmptyState />;
          const byDay = new Map<string, number>();
          for (const p of pts)
            byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.cost);
          const rows = [...byDay.entries()].map(([day, cost]) => ({ day, cost }));
          return (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-base-300" />
              <XAxis
                dataKey="day"
                tickFormatter={tickFmt}
                fontSize={11}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v) => formatCost(Number(v))}
                fontSize={11}
                width={56}
              />
              <Tooltip
                formatter={(value) => formatCost(Number(value ?? 0))}
                labelFormatter={(l) => String(l)}
              />
              <Line
                type="monotone"
                dataKey="cost"
                name={t("kpiCost")}
                stroke="var(--color-primary)"
                strokeWidth={2}
                dot={false}
              />
              </LineChart>
            </ResponsiveContainer>
          );
        })()}
      </AsyncState>
    </ChartCard>
  );
}

// --- Token share per day (100% stacked AreaChart) ---

const SHARE_CATS = [
  { key: "input", field: "inputTokens", labelKey: "tokInput", color: "var(--color-primary)" },
  { key: "cacheRead", field: "cacheReadTokens", labelKey: "tokCacheRead", color: "var(--color-info)" },
  { key: "output", field: "outputTokens", labelKey: "tokOutput", color: "var(--color-secondary)" },
  { key: "reasoning", field: "reasoningTokens", labelKey: "tokReasoning", color: "var(--color-accent)" },
] as const;

type ShareRow = Record<string, number | string>;

function TokenShareChart() {
  const api = usePoll((signal) => getTimeseries("day", "total", signal));

  // Aggregate per day (groupBy="total" -> one point per day) and normalize the
  // four categories to a 0-100% share; keep absolute values for the tooltip.
  const rows: ShareRow[] = (() => {
    const pts = api.data?.points ?? [];
    const byDay = new Map<string, ShareRow>();
    for (const p of pts) {
      const row = byDay.get(p.day) ?? { day: p.day };
      for (const c of SHARE_CATS) {
        row[c.key] = ((row[c.key] as number) ?? 0) + (p[c.field] as number);
      }
      byDay.set(p.day, row);
    }
    const out: ShareRow[] = [];
    for (const row of byDay.values()) {
      const sum =
        SHARE_CATS.reduce((s, c) => s + (row[c.key] as number), 0) || 1;
      const r: ShareRow = { day: String(row.day), total: sum };
      for (const c of SHARE_CATS) {
        const abs = row[c.key] as number;
        r[c.key] = abs;
        r[`${c.key}Pct`] = (abs / sum) * 100;
      }
      out.push(r);
    }
    return out;
  })();

  return (
    <ChartCard
      title={t("chartTokenShareDay")}
      height={340}
      empty={rows.length === 0}
    >
      <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
        {(() => {
          if (rows.length === 0) return <EmptyState />;
          return (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={rows}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-base-300"
                />
                <XAxis
                  dataKey="day"
                  tickFormatter={shortDay}
                  fontSize={11}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${Number(v)}%`}
                  fontSize={11}
                  width={44}
                />
                <Tooltip content={<TokenShareTooltip cats={SHARE_CATS} />} />
                <Legend wrapperStyle={{ flexWrap: "wrap" }} />
                {SHARE_CATS.map((c) => (
                  <Area
                    key={c.key}
                    type="monotone"
                    dataKey={`${c.key}Pct`}
                    name={t(c.labelKey)}
                    stackId="1"
                    fill={c.color}
                    stroke={c.color}
                    fillOpacity={0.7}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          );
        })()}
      </AsyncState>
    </ChartCard>
  );
}

function TokenShareTooltip({ active, payload, cats }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2 text-xs shadow">
      <div className="mb-1 font-medium">{row.day}</div>
      {cats.map((c: any) => {
        const abs = Number(row[c.key]) || 0;
        const pct = Number(row[`${c.key}Pct`]) || 0;
        return (
          <div key={c.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            <span>{t(c.labelKey)}:</span>
            <span>{formatTokens(abs)}</span>
            <span className="text-base-content/60">({pct.toFixed(1)}%)</span>
          </div>
        );
      })}
      <div className="mt-1 border-t border-base-300 pt-1 font-medium">
        {t("cardTotal")}: {formatTokens(Number(row.total) || 0)}
      </div>
    </div>
  );
}

// --- Heatmap (rows = hours 0-23, columns = weeks) ---

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function HeatmapCard() {
  const api = usePoll(getHeatmap);
  const lang = useLang();

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title text-base">{t("heatmapTitle")}</h2>
          <HeatmapLegend />
        </div>
        <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
          {(() => {
            const cells = api.data ?? [];
            if (cells.length === 0) return <EmptyState />;
            return <HeatmapGrid cells={cells} lang={lang} />;
          })()}
        </AsyncState>
      </div>
    </div>
  );
}

function HeatmapGrid({ cells, lang }: { cells: HeatmapCell[]; lang: Lang }) {
  // Aggregate by (week, hour)
  const weekMap = new Map<string, Map<number, number>>();
  let max = 0;
  for (const c of cells) {
    const monday = mondayOf(new Date(c.day + "T00:00:00"));
    const wk = ymd(monday);
    let hours = weekMap.get(wk);
    if (!hours) {
      hours = new Map();
      weekMap.set(wk, hours);
    }
    const cur = (hours.get(c.hour) ?? 0) + c.msgCount;
    hours.set(c.hour, cur);
    if (cur > max) max = cur;
  }

  const weeks = [...weekMap.keys()].sort();
  // Keep the most recent ~24 weeks for readability.
  const visible = weeks.slice(-24);
  const n = visible.length;

  const intensity = (count: number) =>
    count <= 0 ? 0 : 0.15 + 0.85 * (count / (max || 1));

  // CSS grid: a fixed label column + one flexible column per week so the
  // heatmap fills the full card width; cells stay square via aspect-square.
  return (
    <div className="max-h-[60vh] overflow-auto">
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `2.5rem repeat(${n}, minmax(0, 1fr))` }}
      >
        {/* Corner + week headers (sticky top) */}
        <div className="sticky top-0 left-0 z-20 bg-base-200" />
        {visible.map((wk) => {
          const label = formatDate(new Date(wk + "T00:00:00").getTime(), lang);
          return (
            <div
              key={wk}
              className="sticky top-0 z-10 truncate bg-base-200 text-center text-[10px] text-base-content/50"
              title={label}
            >
              {shortDay(wk)}
            </div>
          );
        })}

        {/* 24 hour rows (label column sticky left) */}
        {Array.from({ length: 24 }, (_, h) => (
          <Fragment key={h}>
            <div className="sticky left-0 z-10 flex items-center justify-end bg-base-200 pr-1 text-[10px] text-base-content/50">
              {h % 6 === 0 ? h : ""}
            </div>
            {visible.map((wk) => {
              const count = weekMap.get(wk)!.get(h) ?? 0;
              const pct = intensity(count);
              const bg =
                count > 0
                  ? `color-mix(in oklab, var(--color-primary) ${Math.round(
                      pct * 100,
                    )}%, transparent)`
                  : "var(--color-base-300)";
              const label = formatDate(
                new Date(wk + "T00:00:00").getTime(),
                lang,
              );
              return (
                <div
                  key={wk}
                  className="aspect-square w-full rounded-[2px]"
                  style={{ backgroundColor: bg }}
                  title={`${label} · ${t("heatmapHour", { hour: h })} · ${t(
                    "heatmapCount",
                    { count: count },
                  )}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function HeatmapLegend() {
  return (
    <div className="flex items-center gap-1 text-[10px] text-base-content/50">
      <span>{t("heatmapLess")}</span>
      {[0.15, 0.4, 0.65, 0.9, 1].map((p) => (
        <span
          key={p}
          className="h-3 w-3 rounded-[2px]"
          style={{
            backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(
              p * 100,
            )}%, transparent)`,
          }}
        />
      ))}
      <span>{t("heatmapMore")}</span>
    </div>
  );
}
