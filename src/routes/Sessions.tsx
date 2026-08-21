/**
 * Sessions ("/sessions")
 *  - Cache-analysis section (ScatterChart + regression line + Pearson KPI +
 *    bucket-average bars) from getCacheAnalysis()
 *  - Sortable, paginated, filterable session table from getSessions()
 *  - Expandable row detail (msg count, cache-hit radial, token breakdown)
 *
 * The list is keyed by (sort/dir/offset) in the parent so the data hook
 * re-fetches whenever those change; the client-side filter lives in the parent
 * and survives remounts.
 */

import { useState } from "react";
import type { CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  getCacheAnalysis,
  getSessions,
  usePoll,
  type SessionSort,
} from "../lib/api";
import type { CacheAnalysis, SessionRow } from "../lib/types";
import {
  basename,
  formatCost,
  formatDate,
  formatInt,
  formatRatio,
  formatSessionTitle,
  formatTokens,
} from "../lib/format";
import { t, useLang, type Lang, type TranslationKey } from "../lib/i18n";
import { AsyncState, EmptyState } from "../components/Async";
import { ChartCard } from "../components/ChartCard";

const PAGE = 50;

type Dir = "asc" | "desc";

export default function Sessions() {
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<SessionSort>("recent");
  const [dir, setDir] = useState<Dir>("desc");
  const [filter, setFilter] = useState("");
  const [minMessages, setMinMessages] = useState(20);

  const setSortField = (next: SessionSort) => {
    if (next === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(next);
      setDir(next === "title" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("routeSessions")}</h1>

      <CacheAnalysisSection
        minMessages={minMessages}
        onMinMessages={setMinMessages}
      />

      <div className="card bg-base-200 shadow-sm">
        <div className="card-body gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="card-title text-base">{t("routeSessions")}</h2>
            <input
              type="text"
              className="input input-bordered input-sm w-full max-w-xs"
              placeholder={t("sessionsFilter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <SessionList
            key={`${sort}-${dir}-${offset}`}
            query={{ limit: PAGE, offset, sort, dir }}
            filter={filter}
            onOffset={setOffset}
            onSortField={setSortField}
            sort={sort}
            dir={dir}
          />
        </div>
      </div>
    </div>
  );
}

// --- Cache analysis ---

function CacheAnalysisSection({
  minMessages,
  onMinMessages,
}: {
  minMessages: number;
  onMinMessages: (n: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-semibold">{t("cacheAnalysis")}</h2>
        <ThresholdSelect value={minMessages} onChange={onMinMessages} />
      </div>
      <p className="text-sm text-base-content/70">
        {t("cacheExcludedHint", { n: minMessages })}
      </p>

      <CacheAnalysisData key={minMessages} minMessages={minMessages} />
    </div>
  );
}

function ThresholdSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm opacity-70">{t("cacheThreshold")}</span>
      <select
        className="select select-bordered select-xs"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {[10, 20, 50].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}

function CacheAnalysisData({ minMessages }: { minMessages: number }) {
  const api = usePoll((signal) => getCacheAnalysis(minMessages, signal));

  return (
    <>
      <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
        {(() => {
          const data = api.data;
          if (!data || data.points.length === 0)
            return <p className="text-base-content/60">{t("cacheNoData")}</p>;
          return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <ChartCard title={t("cacheMsgVsRatio")} height={320}>
                  <ScatterPlot data={data} />
                </ChartCard>
              </div>
              <CorrelationCard data={data} />
            </div>
          );
        })()}
      </AsyncState>

      <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
        {(() => {
          const data = api.data;
          const empty = !data || data.bucketAverages.length === 0;
          return (
            <ChartCard title={t("cacheBucketAvg")} height={260} empty={empty}>
              {(() => {
                if (empty) return <EmptyState />;
                return (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.bucketAverages.map((b) => ({
                        bucket: b.bucket,
                        avg: Math.round(b.avgCacheHitRatio * 100),
                        count: b.count,
                      }))}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-base-300"
                      />
                      <XAxis dataKey="bucket" fontSize={11} />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(v) => `${Number(v)}%`}
                        fontSize={11}
                        width={44}
                      />
                      <Tooltip
                        formatter={(value, name) =>
                          name === "avg"
                            ? `${Number(value)}%`
                            : `${Number(value)}`
                        }
                        labelFormatter={(l) =>
                          t("cacheBucket", { bucket: String(l) })
                        }
                      />
                      <Bar
                        dataKey="avg"
                        name="avg"
                        fill="var(--color-secondary)"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </ChartCard>
          );
        })()}
      </AsyncState>
    </>
  );
}

type ScatterDatum = {
  x: number;
  y: number;
  title: string | null;
  tokens: number;
  cost: number;
};

function ScatterPlot({ data }: { data: CacheAnalysis }) {
  const points: ScatterDatum[] = data.points.map((p) => ({
    x: p.msgCount,
    y: Math.round(p.cacheHitRatio * 100),
    title: p.title,
    tokens: p.totalTokens,
    cost: p.cost,
  }));

  const pearson = data.pearsonCorrelation;
  const weak = pearson != null && Math.abs(pearson) < 0.5;

  let regression: { x: number; y: number }[] | null = null;
  if (data.linearFit && points.length >= 2) {
    const fit = data.linearFit;
    const xs = points.map((p) => p.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const predict = (x: number) =>
      clamp(Math.round((fit.slope * x + fit.intercept) * 100), 0, 100);
    regression = [
      { x: xMin, y: predict(xMin) },
      { x: xMax, y: predict(xMax) },
    ];
  }

  const rLabel =
    pearson != null
      ? t("cacheRegression", { r: pearson.toFixed(2) })
      : t("seriesOther");

  // Weak correlation (|pearson| < 0.5): neutral, dashed line. Otherwise a
  // strong accent color. Never let the line stretch the [0,100] axis.
  const lineStyle = weak
    ? {
        stroke: "var(--color-base-content)",
        strokeWidth: 2.5,
        strokeDasharray: "6 4",
      }
    : { stroke: "var(--color-error)", strokeWidth: 2.5 };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-base-300" />
        <XAxis
          type="number"
          dataKey="x"
          name={t("cacheScatterX")}
          fontSize={11}
          tickFormatter={(v) => formatInt(Number(v), "en")}
          interval="preserveStartEnd"
        />
        <YAxis
          type="number"
          dataKey="y"
          name={t("cacheScatterY")}
          domain={[0, 100]}
          fontSize={11}
          width={44}
          tickFormatter={(v) => `${Number(v)}%`}
        />
        {/* Fixed point size (~r=3) for the scatter dots. */}
        <ZAxis range={[28, 28]} />
        <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} />
        <Legend />
        <Scatter
          name={t("routeSessions")}
          data={points}
          fill="var(--color-primary)"
          fillOpacity={0.5}
        />
        {regression && (
          <Scatter
            name={rLabel}
            data={regression}
            line={lineStyle}
            legendType="none"
          />
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function ScatterTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload.find((e: any) => e.payload?.title)?.payload as
    | ScatterDatum
    | undefined;
  if (!p) return null;
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2 text-xs shadow">
      <div className="font-medium">
        {formatSessionTitle(p.title, "en")}
      </div>
      <div>{t("cacheScatterX")}: {formatInt(p.x, "en")}</div>
      <div>{t("cacheScatterY")}: {p.y}%</div>
      <div>{t("colTokens")}: {formatTokens(p.tokens)}</div>
      <div>{t("kpiCost")}: {formatCost(p.cost)}</div>
    </div>
  );
}

function CorrelationCard({ data }: { data: CacheAnalysis }) {
  const r = data.pearsonCorrelation;
  let strengthKey: TranslationKey = "corrNone2";
  let dirKey: TranslationKey = "corrDirPos";
  if (r != null) {
    const ar = Math.abs(r);
    dirKey = r >= 0 ? "corrDirPos" : "corrDirNeg";
    if (ar >= 0.7) strengthKey = "corrStrong";
    else if (ar >= 0.3) strengthKey = "corrWeak";
  }
  const dir = t(dirKey);

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body gap-2">
        <h3 className="card-title text-base">{t("cacheCorrelation")}</h3>
        <div className="stat-value text-4xl text-primary">
          {r != null ? r.toFixed(2) : "—"}
        </div>
        <p className="text-sm">
          {r != null ? t(strengthKey, { dir }) : t("cacheCorrelationNone")}
        </p>
        {r != null && strengthKey !== "corrNone2" && (
          <p className="text-xs text-base-content/70">
            {t("corrSummary", { dir })}
          </p>
        )}
      </div>
    </div>
  );
}

// --- Session list ---

function SessionList({
  query,
  filter,
  onOffset,
  onSortField,
  sort,
  dir,
}: {
  query: { limit: number; offset: number; sort: SessionSort; dir: Dir };
  filter: string;
  onOffset: (n: number) => void;
  onSortField: (s: SessionSort) => void;
  sort: SessionSort;
  dir: Dir;
}) {
  const api = usePoll((signal) => getSessions(query, signal));
  const lang = useLang();
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = (api.data ?? []).filter((s) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      (s.title ?? "").toLowerCase().includes(q) ||
      s.directory.toLowerCase().includes(q)
    );
  });

  const from = query.offset + 1;
  const to = query.offset + (api.data?.length ?? 0);
  const hasPrev = query.offset > 0;
  const hasNext = (api.data?.length ?? 0) === query.limit;

  const arrow = (key: SessionSort) => (key === sort ? (dir === "asc" ? " ▲" : " ▼") : "");

  return (
    <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
      {(() => {
        if (!api.data || api.data.length === 0)
          return <p className="text-base-content/60">{t("stateNoData")}</p>;
        return (
          <>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => onSortField("title")}
                    >
                      {t("colTitle")}
                      {arrow("title")}
                    </th>
                    <th>{t("colDirectory")}</th>
                    <th
                      className="cursor-pointer select-none text-right"
                      onClick={() => onSortField("msgCount")}
                    >
                      {t("colMessages")}
                      {arrow("msgCount")}
                    </th>
                    <th
                      className="cursor-pointer select-none text-right"
                      onClick={() => onSortField("cost")}
                    >
                      {t("kpiCost")}
                      {arrow("cost")}
                    </th>
                    <th
                      className="cursor-pointer select-none text-right"
                      onClick={() => onSortField("cacheHitRatio")}
                    >
                      {t("colCacheRatio")}
                      {arrow("cacheHitRatio")}
                    </th>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => onSortField("timeCreated")}
                    >
                      {t("colDate")}
                      {arrow("timeCreated")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <SessionRowItem
                      key={s.sessionId}
                      row={s}
                      lang={lang}
                      expanded={expanded === s.sessionId}
                      onToggle={() =>
                        setExpanded((id) =>
                          id === s.sessionId ? null : s.sessionId,
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-base-content/60">
                {t("sessionsShowing", { from, to })}
              </span>
              <div className="join">
                <button
                  className="btn btn-sm join-item"
                  disabled={!hasPrev}
                  onClick={() => onOffset(Math.max(0, query.offset - PAGE))}
                >
                  {t("sessionsPrev")}
                </button>
                <button
                  className="btn btn-sm join-item"
                  disabled={!hasNext}
                  onClick={() => onOffset(query.offset + PAGE)}
                >
                  {t("sessionsNext")}
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </AsyncState>
  );
}

function SessionRowItem({
  row,
  lang,
  expanded,
  onToggle,
}: {
  row: SessionRow;
  lang: Lang;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer hover:bg-base-300/40"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <td className="max-w-[22rem]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              tabIndex={-1}
              aria-label={expanded ? "collapse" : "expand"}
              className="btn btn-ghost btn-xs btn-circle"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              {expanded ? "▲" : "▼"}
            </button>
            <div
              className="line-clamp-2 font-medium"
              title={row.title ?? undefined}
            >
              {formatSessionTitle(row.title, lang)}
            </div>
          </div>
        </td>
        <td
          className="max-w-[14rem] truncate text-base-content/70"
          title={row.directory}
        >
          {basename(row.directory)}
        </td>
        <td className="text-right">{formatInt(row.msgCount, lang)}</td>
        <td className="text-right">{formatCost(row.cost)}</td>
        <td className="text-right">
          <div
            className="radial-progress text-primary text-[9px]"
            style={
              {
                "--value": Math.round(row.cacheHitRatio * 100),
                "--size": "1.8rem",
                "--thickness": "2px",
              } as CSSProperties
            }
            role="img"
            aria-label={formatRatio(row.cacheHitRatio)}
          >
            {Math.round(row.cacheHitRatio * 100)}%
          </div>
        </td>
        <td className="text-base-content/70">
          {formatDate(row.timeUpdated, lang)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-base-100">
            <SessionDetail row={row} lang={lang} />
          </td>
        </tr>
      )}
    </>
  );
}

function SessionDetail({ row, lang }: { row: SessionRow; lang: Lang }) {
  return (
    <div className="grid grid-cols-1 gap-4 p-2 md:grid-cols-2">
      <div className="space-y-1 text-sm">
        <div>
          <span className="opacity-60">{t("sessionsDetail")}: </span>
          {formatSessionTitle(row.title, lang)}
        </div>
        <div>
          <span className="opacity-60">{t("colDirectory")}: </span>
          {row.directory}
        </div>
        <div>
          <span className="opacity-60">{t("colModel")}: </span>
          {row.modelId ?? "—"}
        </div>
        <div>
          <span className="opacity-60">{t("colAgent")}: </span>
          {row.agent ?? "—"}
        </div>
        <div>
          <span className="opacity-60">{t("colMessages")}: </span>
          {formatInt(row.msgCount, lang)}
        </div>
        <div>
          <span className="opacity-60">{t("kpiCost")}: </span>
          {formatCost(row.cost)}
        </div>
        <div>
          <span className="opacity-60">{t("colDate")}: </span>
          {formatDate(row.timeCreated, lang)}
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">{t("sessionsBreakdown")}</div>
        <TokenBreakdown
          input={row.inputTokens}
          output={row.outputTokens}
          reasoning={row.reasoningTokens}
          cacheRead={row.cacheReadTokens}
        />
      </div>
    </div>
  );
}

function TokenBreakdown({
  input,
  output,
  reasoning,
  cacheRead,
}: {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
}) {
  const parts = [
    { label: t("tokInput"), value: input, color: "var(--color-primary)" },
    { label: t("tokOutput"), value: output, color: "var(--color-secondary)" },
    { label: t("tokReasoning"), value: reasoning, color: "var(--color-accent)" },
    { label: t("tokCacheRead"), value: cacheRead, color: "var(--color-info)" },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded">
        {parts.map(
          (p, i) =>
            p.value > 0 && (
              <div
                key={i}
                style={{
                  width: `${(p.value / total) * 100}%`,
                  backgroundColor: p.color,
                }}
                title={`${p.label}: ${formatTokens(p.value)}`}
              />
            ),
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/70">
        {parts.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            {p.label}: {formatTokens(p.value)}
          </span>
        ))}
      </div>
    </div>
  );
}
