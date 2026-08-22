/**
 * Dashboard ("/")
 *  - Share dialog (URL params ?share=today|week|month + ?sharehide=1): opens
 *    via the header "Teilen" button or a shared link; shows a server-rendered
 *    statistics card with PNG download / clipboard / SVG actions
 *  - Day-detail drill-down section (URL param ?day=YYYY-MM-DD) at the top
 *  - KPI row from getSummary()
 *  - Stacked token-trend BarChart from getTimeseries() (granularity + groupBy
 *    switches, URL-synced via ?gran= and ?group=; clicking a bar drills into
 *    that day/period)
 *  - Cost-trend LineChart from getTimeseries()
 *  - Token-share AreaChart (clicking drills into that day)
 *  - Activity heatmap from getHeatmap() (rows = hours 0-23, columns = weeks;
 *    clicking a cell drills into its busiest day)
 *
 * All fetchers forward the global project filter (URL param ?project) as
 * FetchOpts; consumers are remounted via keys when the filter changes.
 * All data hooks use usePoll (60s auto-refresh) and surface loading / error /
 * retry states through the shared components.
 */

import { Fragment } from "react";
import { useSearchParams } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
  shortWeek,
} from "../lib/format";
import { t, useLang, getLang, type Lang } from "../lib/i18n";
import { AsyncState, EmptyState, ErrorState, Spinner } from "../components/Async";
import { ChartCard } from "../components/ChartCard";
import { KpiCard } from "../components/KpiCard";
import { periodRange, type PeriodUnit } from "../lib/period";
import { paletteColor } from "../components/colors";
import ShareDialog, { type ShareRange } from "../components/ShareDialog";
import { readProjectParam } from "../components/ProjectFilterBar";

const TOKEN_FIELDS = [
  { field: "inputTokens", key: "input", labelKey: "tokInput" },
  { field: "outputTokens", key: "output", labelKey: "tokOutputIncl" },
  { field: "cacheReadTokens", key: "cacheRead", labelKey: "tokCacheRead" },
] as const;

/**
 * X-Achsen-/Label-Formatierung passend zur Auflösung — von allen
 * Dashboard-Zeitverlauf-Charts gemeinsam genutzt (Token-Trend, Kosten-
 * verlauf, Token-Anteile): „Gesamt" → Pseudo-Bucket-Label, Tag → Kurzdatum,
 * Woche/Monat → Monat(sstart). Vorher nutzten Kosten-/Anteils-Chart immer
 * Tages-Labels, auch bei Woche/Monat.
 */
function granTickFmt(g: Granularity): (day: string) => string {
  return (day: string) =>
    g === "all"
      ? t("granAll")
      : g === "day"
        ? shortDay(day)
        : g === "week"
          ? shortWeek(day, getLang())
          : shortMonth(day);
}

/**
 * Menschliche Entscheidung (2026-08-21): Reasoning wird zu Output kombiniert
 * (ein Segment), Cache Read zählt in ALLE Totale — KPI „Gesamt-Tokens",
 * Stapel-Totale und Gruppierungs-Ranking verwenden dieselbe Definition.
 * Die Timeseries liefert die Felder getrennt → hier einmalig falten.
 */
function foldReasoningIntoOutput(
  points: TimeseriesPoint[],
): TimeseriesPoint[] {
  return points.map((p) => ({
    ...p,
    outputTokens: p.outputTokens + p.reasoningTokens,
    reasoningTokens: 0,
  }));
}

type Row = Record<string, number | string>;

/** Global period filter: selected bucket start ("YYYY-MM-DD") + its unit. */
const PERIOD_PARAM = "period";
const PPERIOD_PARAM = "pperiod";
/** URL param for the token-trend granularity (?gran=day|week|month|all). */
const GRAN_PARAM = "gran";
/** URL param for the token-trend grouping (?group=total|provider|…). */
const GROUP_PARAM = "group";
/**
 * URL param opening the share dialog (?share=today|week|month). Present with
 * a valid value ⇒ dialog open; missing/invalid ⇒ closed (no URL rewrite —
 * same policy as gran/group).
 */
const SHARE_PARAM = "share";
/** Project mode in the share card (?shareproj=all|hide|none). */
const SHARE_PROJ_PARAM = "shareproj";
/** Image language, independent of the UI language (?sharelang=de|en). */
const SHARE_LANG_PARAM = "sharelang";

const GRANULARITIES = ["day", "week", "month", "all"] as const satisfies readonly Granularity[];
const SHARE_RANGES = ["today", "week", "month"] as const satisfies readonly ShareRange[];
const GROUP_BYS = [
  "total",
  "provider",
  "family",
  "manufacturer",
  "model",
] as const satisfies readonly GroupBy[];
const DEFAULT_GRANULARITY: Granularity = "day";
const DEFAULT_GROUP_BY: GroupBy = "total";
const DEFAULT_SHARE_RANGE: ShareRange = "week";

/** Parse a query-param value against an allow-list, falling back on miss. */
function parseEnumParam<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return raw != null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

export default function Dashboard() {
  // Token-trend filters live in the URL (shareable links, rule "URL-Sync").
  // Missing/invalid values fall back to the defaults WITHOUT rewriting the
  // URL — only explicit user interaction writes params.
  const [searchParams, setSearchParams] = useSearchParams();
  const project = readProjectParam(searchParams);
  // Globaler Zeitraum-Filter: ?period=<start>&pperiod=<day|week|month>.
  // Ein crafted Wert (z. B. ?period=summary) würde sonst als Key-Fragment
  // fremde Sibling-Keys kollidieren (gleiche Bugklasse wie Ghost-Charts).
  const periodRaw = searchParams.get(PERIOD_PARAM);
  const pperiodRaw = searchParams.get(PPERIOD_PARAM);
  const periodUnit: PeriodUnit | null =
    pperiodRaw === "day" || pperiodRaw === "week" || pperiodRaw === "month"
      ? pperiodRaw
      : null;
  const period =
    periodRaw != null && /^\d{4}-\d{2}-\d{2}$/.test(periodRaw) && periodUnit
      ? periodRaw
      : null;
  // Explicit from/to window for the selected period; null = no global filter.
  const range = period && periodUnit ? periodRange(period, periodUnit) : null;
  const granularity = parseEnumParam(
    searchParams.get(GRAN_PARAM),
    GRANULARITIES,
    DEFAULT_GRANULARITY,
  );
  const groupBy = parseEnumParam(
    searchParams.get(GROUP_PARAM),
    GROUP_BYS,
    DEFAULT_GROUP_BY,
  );

  // Share dialog state: ?share=<range> opens it, ?shareproj=all|hide|none
  // steers the project section, ?sharelang=de|en sets the IMAGE language
  // (independent of the UI language). Invalid share values mean "closed"
  // WITHOUT rewriting the URL (same policy as gran/group).
  const shareRaw = searchParams.get(SHARE_PARAM);
  const shareOpen =
    shareRaw != null && (SHARE_RANGES as readonly string[]).includes(shareRaw);
  const shareRange: ShareRange =
    shareOpen && shareRaw ? (shareRaw as ShareRange) : DEFAULT_SHARE_RANGE;
  const shareProjRaw = searchParams.get(SHARE_PROJ_PARAM);
  const shareProjects: "all" | "hide" | "none" =
    shareProjRaw === "hide" || shareProjRaw === "none" ? shareProjRaw : "all";
  const shareLangRaw = searchParams.get(SHARE_LANG_PARAM);
  const uiLang = useLang();
  const shareImgLang: Lang =
    shareLangRaw === "en" ? "en" : shareLangRaw === "de" ? "de" : uiLang;

  /**
   * Select / toggle a period. `start` is the bucket's start date (as produced by
   * the trend chart's `day` field) and `unit` its granularity. Clicking the
   * already-selected period clears it again. Preserves all other query params.
   */
  const togglePeriod = (start: string, unit: PeriodUnit) => {
    const params = new URLSearchParams(searchParams);
    if (period === start && periodUnit === unit) {
      params.delete(PERIOD_PARAM);
      params.delete(PPERIOD_PARAM);
    } else {
      params.set(PERIOD_PARAM, start);
      params.set(PPERIOD_PARAM, unit);
    }
    setSearchParams(params);
  };

  /** Write a filter param while preserving all other query params. */
  const setFilterParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params);
  };

  /** Open/switch the share dialog range (?share=…), preserving other params. */
  const setShareParam = (range: ShareRange | null) => {
    const params = new URLSearchParams(searchParams);
    if (range) {
      params.set(SHARE_PARAM, range);
    } else {
      // Closing removes ALL share params so the plain dashboard link stays.
      params.delete(SHARE_PARAM);
      params.delete(SHARE_PROJ_PARAM);
      params.delete(SHARE_LANG_PARAM);
    }
    setSearchParams(params);
  };

  /** Set ?shareproj=all|hide|none while preserving all other query params. */
  const setShareProj = (mode: "all" | "hide" | "none") => {
    const params = new URLSearchParams(searchParams);
    // "all" ist der Default — Parameter dann gar nicht erst setzen.
    if (mode === "all") params.delete(SHARE_PROJ_PARAM);
    else params.set(SHARE_PROJ_PARAM, mode);
    setSearchParams(params);
  };

  /** Set ?sharelang=de|en while preserving all other query params. */
  const setShareImgLang = (lang: Lang) => {
    const params = new URLSearchParams(searchParams);
    if (lang === uiLang) params.delete(SHARE_LANG_PARAM);
    else params.set(SHARE_LANG_PARAM, lang);
    setSearchParams(params);
  };

  return (
    <div className="space-y-6">
      {/* Header row: page title left, share action right (dialog state lives
          in the URL: ?share=today|week|month, ?shareproj=all|hide|none,
          ?sharelang=de|en). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">{t("routeDashboard")}</h1>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => setShareParam(DEFAULT_SHARE_RANGE)}
        >
          {t("shareButton")}
        </button>
      </div>

      {shareOpen && (
        <ShareDialog
          range={shareRange}
          project={project}
          projects={shareProjects}
          imgLang={shareImgLang}
          onRange={setShareParam}
          onProjects={setShareProj}
          onImgLang={setShareImgLang}
          onClose={() => setShareParam(null)}
        />
      )}

      {/* Globale Auflösung: steuert ALLE Daten-Charts (Zeitverlauf,
          Kostenverlauf, Token-Anteile) — nicht nur den Token-Zeitverlauf. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GranularitySwitch
          value={granularity}
          onChange={(g) => setFilterParam(GRAN_PARAM, g)}
        />
      </div>

      {/* Keys include `project` AND `granularity`: useApi keeps its fetcher in
          a ref and only refetches on mount, so a filter change must remount the
          consumers. SummaryKpis folgt der globalen Auflösung (?gran=):
          Tag=heute, Woche=aktuelle KW (Mo–So), Monat=laufender Monat,
          All=gesamte Historie (kein from/to). */}
      <SummaryKpis
        key={`summary|${granularity}-${period ?? "all"}-${project ?? "all"}`}
        granularity={granularity}
        project={project}
        from={range?.from}
        to={range?.to}
      />

      <TokenTrendChart
        key={`trend|${granularity}-${groupBy}-${project ?? "all"}`}
        granularity={granularity}
        groupBy={groupBy}
        project={project}
        onGroupBy={(g) => setFilterParam(GROUP_PARAM, g)}
        onSelectDay={(d) => {
          if (granularity !== "all") togglePeriod(d, granularity);
        }}
      />

      {/* The selected period is a GLOBAL drill-down: the trend chart stays the
          full overview + navigator, while every other panel below reflects the
          chosen period (KPIs, cost/share/heatmap here; Sessions/Models/Projects
          on their own routes). The chip in the global filter bar clears it. */}
      <CostTrendChart
        key={`cost|${granularity}-${period ?? "all"}-${project ?? "all"}`}
        granularity={granularity}
        project={project}
        from={range?.from}
        to={range?.to}
      />

      <TokenShareChart
        key={`share|${granularity}-${period ?? "all"}-${project ?? "all"}`}
        granularity={granularity}
        project={project}
        from={range?.from}
        to={range?.to}
        onSelectDay={(d) => {
          if (granularity !== "all") togglePeriod(d, granularity);
        }}
      />

      {/* Heatmap ist bewusst NICHT an ?gran= gekoppelt: Stunden×Woche kann
          keinen „all“-Bucket darstellen; die 24-Wochen-Kappe bleibt also
          auch bei gran=all aktiv (Audit-Runde 4, Gap 3). */}
      <HeatmapCard
        key={`heatmap|${period ?? "all"}-${project ?? "all"}`}
        project={project}
        from={range?.from}
        to={range?.to}
        onSelectDay={(d) => togglePeriod(d, "day")}
      />
    </div>
  );
}

/** Local-time YYYY-MM-DD for a Date (avoids UTC shift). Named ymdLocal to not
 *  collide with the UTC-based `ymd` used by the HeatmapCard. */
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Maps the global resolution (?gran=) to a date window for the KPI summary:
 *  - day   → heute
 *  - week  → aktuelle KW (Montag–Sonntag)
 *  - month → laufender Monat (1.–letzter)
 *  - all   → gesamte Historie (kein from/to)
 * The week boundary matches the server's bucketDay() (Monday of the local week).
 */
function granularityWindow(g: Granularity): { from?: string; to?: string } {
  if (g === "all") return {};
  const now = new Date();
  if (g === "day") {
    const d = ymdLocal(now);
    return { from: d, to: d };
  }
  if (g === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: ymdLocal(first), to: ymdLocal(last) };
  }
  // week: Monday of the current local week .. following Sunday
  const sinceMonday = (now.getDay() + 6) % 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - sinceMonday);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: ymdLocal(mon), to: ymdLocal(sun) };
}

function SummaryKpis({
  granularity,
  project,
  from,
  to,
}: {
  granularity: Granularity;
  project?: string;
  from?: string;
  to?: string;
}) {
  // When a specific period is selected it overrides the granularity window.
  const { from: wFrom, to: wTo } = granularityWindow(granularity);
  const rangeFrom = from ?? wFrom;
  const rangeTo = to ?? wTo;
  const summary = usePoll((signal) =>
    getSummary(signal, { project, from: rangeFrom, to: rangeTo }),
  );
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
  const opts: Granularity[] = ["day", "week", "month", "all"];
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
            {t(
              g === "day"
                ? "granDay"
                : g === "week"
                  ? "granWeek"
                  : g === "month"
                    ? "granMonth"
                    : "granAll",
            )}
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
  const opts: GroupBy[] = ["total", "provider", "family", "manufacturer"];
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
                  : g === "family"
                    ? "groupFamily"
                    : "groupManufacturer",
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
  project,
  onGroupBy,
  onSelectDay,
}: {
  granularity: Granularity;
  groupBy: GroupBy;
  project?: string;
  onGroupBy: (g: GroupBy) => void;
  onSelectDay: (day: string) => void;
}) {
  const api = usePoll((signal) =>
    getTimeseries(granularity, groupBy, signal, { project }),
  );
  // "all" ist ein Pseudo-Bucket ohne reales Datum → kein Drilldown.
  const canDrillDown = granularity !== "all";
  const tickFmt = granTickFmt(granularity);

  return (
    <ChartCard
      title={t("chartTokenTrend")}
      height={340}
      right={
        // Auflösung ist jetzt ein globaler Filter (über dem Chart);
        // hier bleibt nur die Gruppierung.
        <GroupBySwitch value={groupBy} onChange={onGroupBy} />
      }
      empty={(api.data?.points?.length ?? 0) === 0}
    >
      <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
        {(() => {
          const pts = foldReasoningIntoOutput(api.data?.points ?? []);
          if (pts.length === 0) return <EmptyState />;
          const { rows, series } = buildTokenRows(pts, groupBy);
          const grouped = groupBy !== "total";
          return (
            <ResponsiveContainer width="100%" height="100%">
              {/* Clicking a bar drills down into that day. For week/month
                  granularity the payload's `day` is the period's first day,
                  which is exactly the drill-down target we want. */}
              <BarChart
                data={rows}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                className="cursor-pointer"
              >
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
              <Tooltip content={<TokenTrendTooltip fmtLabel={tickFmt} sortDesc={grouped} />} cursor={{ fill: "var(--color-base-content)", opacity: 0.08 }} />
              {/* Legende größter → kleinster (nur bei Gruppierung; „Gesamt“
                  behält die semantische Token-Typen-Reihenfolge). Eigene
                  Legend-Content-Komponente, da Recharts 3 kein `reversed`
                  mehr kennt — die Bars werden aufsteigend gerendert. */}
              <Legend
                wrapperStyle={{ flexWrap: "wrap" }}
                content={grouped ? <DescLegend /> : undefined}
              />
              {/* Stacking: Recharts legt die ERSTE Serie unters Stapel-Etage.
                  Damit bei Anbieter/Family/Hersteller die Serie mit den meisten
                  Tokens OBEN liegt, werden diese Bars aufsteigend gerendert —
                  Farben bleiben über den Original-Index (absteigend) stabil pro
                  Serie. „Gesamt“ (Input/Cache/Output/Reasoning) unverändert. */}
              {(grouped ? [...series].reverse() : series).map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="tokens"
                  fill={paletteColor(grouped ? series.length - 1 - i : i)}
                  onClick={(data: any) => {
                    if (!canDrillDown) return;
                    const d: unknown = data?.payload?.day;
                    if (typeof d === "string") onSelectDay(d);
                  }}
                />
              ))}
              </BarChart>
            </ResponsiveContainer>
          );
        })()}
      </AsyncState>
    </ChartCard>
  );
}

/**
 * Legend content that renders series in REVERSE render order (i.e. largest
 * first, matching the stacked bars where the biggest segment sits on top).
 */
function DescLegend({ payload }: any) {
  if (!payload?.length) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
      {[...payload].reverse().map((e: any) => (
        <li key={e.dataKey ?? e.value} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: e.color }}
          />
          <span>{e.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Custom tooltip for the stacked token trend: per-series values + day total. */
function TokenTrendTooltip({
  active,
  payload,
  label,
  fmtLabel,
  sortDesc,
}: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, e: any) => s + (Number(e.value) || 0), 0);
  // Gruppierte Ansicht: größter Wert zuerst (passt zur Legende/Stapel-Ordnung).
  const items = sortDesc
    ? [...payload].sort(
        (a: any, b: any) => (Number(b.value) || 0) - (Number(a.value) || 0),
      )
    : payload;
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2 text-xs shadow">
      <div className="mb-1 font-medium">{fmtLabel ? fmtLabel(label) : label}</div>
      {items.map((e: any) => (
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

function CostTrendChart({
  granularity,
  project,
  from,
  to,
}: {
  granularity: Granularity;
  project?: string;
  from?: string;
  to?: string;
}) {
  // When a period is selected globally, drill this chart into that period at day
  // granularity (the trend chart above stays the full overview navigator).
  const scoped = from != null && to != null;
  const g = scoped ? "day" : granularity;
  const api = usePoll((signal) =>
    getTimeseries(g, "total", signal, { project, from, to }),
  );
  const tickFmt = granTickFmt(g);

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
              <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                labelFormatter={(l) => tickFmt(String(l))}
              />
              <Bar
                dataKey="cost"
                name={t("kpiCost")}
                fill="var(--color-primary)"
                radius={[2, 2, 0, 0]}
              />
              </BarChart>
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
  { key: "output", field: "outputTokens", labelKey: "tokOutputIncl", color: "var(--color-secondary)" },
  { key: "cacheRead", field: "cacheReadTokens", labelKey: "tokCacheRead", color: "var(--color-info)" },
] as const;

type ShareRow = Record<string, number | string>;

function TokenShareChart({
  granularity,
  project,
  from,
  to,
  onSelectDay,
}: {
  granularity: Granularity;
  project?: string;
  from?: string;
  to?: string;
  onSelectDay: (day: string) => void;
}) {
  const scoped = from != null && to != null;
  const g = scoped ? "day" : granularity;
  const api = usePoll((signal) =>
    getTimeseries(g, "total", signal, { project, from, to }),
  );
  // Bei „all“ ist der Bucket kein reales Datum → kein Drilldown.
  const canDrillDown = g !== "all";
  const tickFmt = granTickFmt(g);

  // Aggregate per day (groupBy="total" -> one point per day) and normalize the
  // four categories to a 0-100% share; keep absolute values for the tooltip.
  const rows: ShareRow[] = (() => {
    const pts = foldReasoningIntoOutput(api.data?.points ?? []);
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
              <BarChart
                data={rows}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                className="cursor-pointer"
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-base-300"
                />
                <XAxis
                  dataKey="day"
                  tickFormatter={tickFmt}
                  fontSize={11}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${Number(v)}%`}
                  fontSize={11}
                  width={44}
                />
                <Tooltip content={<TokenShareTooltip cats={SHARE_CATS} fmtLabel={tickFmt} />} />
                <Legend wrapperStyle={{ flexWrap: "wrap" }} />
                {SHARE_CATS.map((c) => (
                  <Bar
                    key={c.key}
                    dataKey={`${c.key}Pct`}
                    name={t(c.labelKey)}
                    stackId="1"
                    fill={c.color}
                    stroke={c.color}
                    fillOpacity={0.7}
                    onClick={(data: any) => {
                      if (!canDrillDown) return;
                      const d: unknown = data?.payload?.day;
                      if (typeof d === "string") onSelectDay(d);
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          );
        })()}
      </AsyncState>
    </ChartCard>
  );
}

function TokenShareTooltip({ active, payload, cats, fmtLabel }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2 text-xs shadow">
      <div className="mb-1 font-medium">
        {fmtLabel ? fmtLabel(row.day) : row.day}
      </div>
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

function HeatmapCard({
  project,
  from,
  to,
  onSelectDay,
}: {
  project?: string;
  from?: string;
  to?: string;
  onSelectDay: (day: string) => void;
}) {
  const api = usePoll((signal) => getHeatmap(signal, { project, from, to }));
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
            return (
              <HeatmapGrid cells={cells} lang={lang} onSelectDay={onSelectDay} />
            );
          })()}
        </AsyncState>
      </div>
    </div>
  );
}

/** Aggregated (week, hour) bucket: total messages + its busiest day. */
interface HourBucket {
  total: number;
  peakDay: string;
  peak: number; // msgCount of the busiest day in this bucket
}

function HeatmapGrid({
  cells,
  lang,
  onSelectDay,
}: {
  cells: HeatmapCell[];
  lang: Lang;
  onSelectDay: (day: string) => void;
}) {
  // Aggregate by (week, hour). A bucket spans up to 7 days, so clicking it
  // drills down into its busiest day (highest per-day msgCount).
  const weekMap = new Map<string, Map<number, HourBucket>>();
  let max = 0;
  for (const c of cells) {
    const monday = mondayOf(new Date(c.day + "T00:00:00"));
    const wk = ymd(monday);
    let hours = weekMap.get(wk);
    if (!hours) {
      hours = new Map();
      weekMap.set(wk, hours);
    }
    const prev = hours.get(c.hour);
    const total = (prev?.total ?? 0) + c.msgCount;
    const bucket: HourBucket =
      prev == null || c.msgCount > prev.peak
        ? { total, peakDay: c.day, peak: c.msgCount }
        : { total, peakDay: prev.peakDay, peak: prev.peak };
    hours.set(c.hour, bucket);
    if (total > max) max = total;
  }

  const weeks = [...weekMap.keys()].sort();
  // Keep the most recent ~24 weeks for readability.
  const visible = weeks.slice(-24);
  const n = visible.length;

  const intensity = (count: number) =>
    count <= 0 ? 0 : 0.15 + 0.85 * (count / (max || 1));

  // CSS grid: a fixed label column + one flexible column per week so the
  // heatmap fills the full card width. Fixed total height — rows share the
  // space (no vertical scrolling).
  return (
    <div className="h-72">
      <div
        className="grid h-full gap-[3px]"
        style={{
          gridTemplateColumns: `2.5rem repeat(${n}, minmax(0, 1fr))`,
          gridTemplateRows: `1.25rem repeat(24, minmax(0, 1fr))`,
        }}
      >
        {/* Corner + week headers */}
        <div className="bg-base-200" />
        {visible.map((wk) => {
          const label = formatDate(new Date(wk + "T00:00:00").getTime(), lang);
          return (
            <div
              key={wk}
              className="truncate bg-base-200 text-center text-[10px] leading-[1.25rem] text-base-content/50"
              title={label}
            >
              {shortWeek(wk, lang)}
            </div>
          );
        })}

        {/* 24 hour rows (label column) */}
        {Array.from({ length: 24 }, (_, h) => (
          <Fragment key={h}>
            <div className="flex items-center justify-end bg-base-200 pr-1 text-[10px] text-base-content/50">
              {h % 6 === 0 ? h : ""}
            </div>
            {visible.map((wk) => {
              const bucket = weekMap.get(wk)?.get(h);
              const count = bucket?.total ?? 0;
              const pct = intensity(count);
              const bg =
                count > 0
                  ? `color-mix(in oklab, var(--color-primary) ${Math.round(
                      pct * 100,
                    )}%, transparent)`
                  : "var(--color-base-300)";
              // Tooltip shows the drill-down target (busiest day of the week).
              const label = formatDate(
                new Date((bucket?.peakDay ?? wk) + "T00:00:00").getTime(),
                lang,
              );
              return (
                <div
                  key={wk}
                  role="button"
                  tabIndex={0}
                  aria-label={`${label} · ${t("heatmapHour", { hour: h })}`}
                  className="w-full cursor-pointer rounded-[2px] transition-[box-shadow] hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ backgroundColor: bg }}
                  title={`${label} · ${t("heatmapHour", { hour: h })} · ${t(
                    "heatmapCount",
                    { count: count },
                  )}`}
                  onClick={() => bucket && onSelectDay(bucket.peakDay)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && bucket) {
                      e.preventDefault();
                      onSelectDay(bucket.peakDay);
                    }
                  }}
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
