/**
 * Projects ("/projects")
 *  - Horizontal bar chart (Recharts layout="vertical") of top projects by cost
 *  - Table: project / directory (basename, full path on hover), sessions,
 *    messages, tokens, cost, last activity (relative time)
 */

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getProjects, usePoll } from "../lib/api";
import type { ProjectRow } from "../lib/types";
import {
  basename,
  formatCost,
  formatInt,
  formatRelative,
  formatTokens,
} from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { AsyncState } from "../components/Async";
import { ChartCard } from "../components/ChartCard";
import { ModeSwitch, type ViewMode } from "../components/ModeSwitch";

type Dir = "asc" | "desc";
type ProjectSort =
  | "project"
  | "sessionCount"
  | "msgCount"
  | "tokens"
  | "cost"
  | "lastActivityAt";

export default function Projects() {
  const api = usePoll(getProjects);
  const lang = useLang();
  const [mode, setMode] = useState<ViewMode>("volume");
  const [expandedDir, setExpandedDir] = useState<string | null>(null);
  const [sort, setSort] = useState<ProjectSort>("lastActivityAt");
  const [dir, setDir] = useState<Dir>("desc");

  const setSortField = (next: ProjectSort) => {
    if (next === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(next);
      setDir(next === "project" ? "asc" : "desc");
    }
  };

  const totalAllCost = (api.data ?? []).reduce((s, p) => s + p.cost, 0);

  const volumeOf = (p: ProjectRow) =>
    p.inputTokens + p.outputTokens + p.reasoningTokens + p.cacheReadTokens;

  const top = [...(api.data ?? [])]
    .sort((a, b) =>
      mode === "volume" ? volumeOf(b) - volumeOf(a) : b.cost - a.cost,
    )
    .slice(0, 12)
    .map((p) => ({
      name: p.name ?? basename(p.directory),
      dir: p.directory,
      value: mode === "volume" ? volumeOf(p) : p.cost,
    }));

  const total = top.reduce((s, d) => s + d.value, 0);
  const totalLabel = mode === "volume" ? formatTokens(total) : formatCost(total);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("routeProjects")}</h1>

      <ChartCard
        title={mode === "volume" ? t("projectsChartVolume") : t("projectsChart")}
        height={360}
        right={<ModeSwitch value={mode} onChange={setMode} />}
        subtitle={
          <span>
            {t("cardTotal")}: {totalLabel}
          </span>
        }
      >
        <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
          {(() => {
            const list = api.data ?? [];
            if (list.length === 0)
              return <p className="text-base-content/60">{t("stateNoData")}</p>;
            return (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={top}
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-base-300"
                />
                <XAxis
                  type="number"
                  tickFormatter={(v) =>
                    mode === "volume"
                      ? formatTokens(Number(v))
                      : formatCost(Number(v))
                  }
                  fontSize={11}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={130}
                  fontSize={10}
                />
                <Tooltip
                  content={<ProjectTooltip mode={mode} />}
                  cursor={{ fill: "var(--color-base-300)", opacity: 0.3 }}
                />
                <Bar
                  dataKey="value"
                  name={mode === "volume" ? t("kpiTotalTokens") : t("kpiCost")}
                  fill="var(--color-primary)"
                />
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </AsyncState>
      </ChartCard>

      <div className="card bg-base-200 shadow-sm">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">{t("colProject")}</h2>
          <AsyncState
            loading={api.loading}
            error={api.error}
            onRetry={api.refetch}
          >
            {(() => {
              const list = api.data ?? [];
              if (list.length === 0)
                return (
                  <p className="text-base-content/60">{t("stateNoData")}</p>
                );

              const sortValue = (p: ProjectRow): number | string => {
                switch (sort) {
                  case "project":
                    return basename(p.directory);
                  case "tokens":
                    return volumeOf(p);
                  default:
                    return p[sort];
                }
              };

              const sorted = [...list].sort((a, b) => {
                const va = sortValue(a);
                const vb = sortValue(b);
                const cmp =
                  typeof va === "string" && typeof vb === "string"
                    ? va.localeCompare(vb)
                    : (va as number) - (vb as number);
                return dir === "asc" ? cmp : -cmp;
              });

              const arrow = (key: ProjectSort) =>
                key === sort ? (dir === "asc" ? " ▲" : " ▼") : "";

              return (
                <div className="overflow-x-auto">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr>
                        <th
                          className="cursor-pointer select-none"
                          onClick={() => setSortField("project")}
                        >
                          {t("colProject")}
                          {arrow("project")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => setSortField("sessionCount")}
                        >
                          {t("colSessions")}
                          {arrow("sessionCount")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => setSortField("msgCount")}
                        >
                          {t("colMessages")}
                          {arrow("msgCount")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => setSortField("tokens")}
                        >
                          {t("colTokens")}
                          {arrow("tokens")}
                        </th>
                        <th
                          className="cursor-pointer select-none text-right"
                          onClick={() => setSortField("cost")}
                        >
                          {t("kpiCost")}
                          {arrow("cost")}
                        </th>
                        <th
                          className="cursor-pointer select-none"
                          onClick={() => setSortField("lastActivityAt")}
                        >
                          {t("colLastActivity")}
                          {arrow("lastActivityAt")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p) => {
                        const expanded = expandedDir === p.directory;
                        return (
                          <ProjectRows
                            key={p.directory}
                            row={p}
                            lang={lang}
                            totalCost={totalAllCost}
                            expanded={expanded}
                            onToggle={() =>
                              setExpandedDir(expanded ? null : p.directory)
                            }
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </AsyncState>
        </div>
      </div>
    </div>
  );
}

function ProjectTooltip({ active, payload, mode }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { dir: string; value: number };
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-2 text-xs shadow">
      <div className="font-medium">{p.dir}</div>
      <div>
        {mode === "volume" ? formatTokens(p.value) : formatCost(p.value)}
      </div>
    </div>
  );
}

// --- Expandable table rows (Projekt = Verzeichnis) ---

function ProjectRows({
  row,
  lang,
  totalCost,
  expanded,
  onToggle,
}: {
  row: ProjectRow;
  lang: ReturnType<typeof useLang>;
  totalCost: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalTokens =
    row.inputTokens + row.outputTokens + row.reasoningTokens;
  const allTokens = totalTokens + row.cacheReadTokens;
  const cacheRatio = allTokens > 0 ? row.cacheReadTokens / allTokens : 0;
  const costShare =
    totalCost > 0 ? Math.round((row.cost / totalCost) * 100) : 0;

  const segments: Array<{
    key: Parameters<typeof t>[0];
    value: number;
    color: string;
  }> = [
    { key: "tokInput", value: row.inputTokens, color: "bg-primary" },
    { key: "tokOutput", value: row.outputTokens, color: "bg-secondary" },
    { key: "tokReasoning", value: row.reasoningTokens, color: "bg-accent" },
    { key: "tokCacheRead", value: row.cacheReadTokens, color: "bg-neutral" },
  ];
  const segTotal = segments.reduce((s, x) => s + x.value, 0);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-base-300/40"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <td className="font-medium">
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
            <span title={row.directory}>{basename(row.directory)}</span>
          </div>
        </td>
        <td className="text-right">{formatInt(row.sessionCount, lang)}</td>
        <td className="text-right">{formatInt(row.msgCount, lang)}</td>
        <td className="text-right">{formatTokens(allTokens)}</td>
        <td className="text-right">{formatCost(row.cost)}</td>
        <td className="text-base-content/70">
          {formatRelative(row.lastActivityAt, lang)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-base-100">
            <div className="grid grid-cols-2 gap-4 p-2 lg:grid-cols-4">
              <div className="stat bg-base-200 rounded-box p-3">
                <div className="stat-title text-xs">{t("kpiCacheHitRatio")}</div>
                <div className="stat-value text-xl text-primary">
                  {Math.round(cacheRatio * 100)}%
                </div>
                <div className="stat-desc">
                  {formatTokens(row.cacheReadTokens)} cache read
                </div>
              </div>
              <div className="stat bg-base-200 rounded-box p-3">
                <div className="stat-title text-xs">{t("kpiCost")}</div>
                <div className="stat-value text-xl">{formatCost(row.cost)}</div>
                <div className="stat-desc">{costShare}% {t("ofTotalCost")}</div>
              </div>
              <div className="stat bg-base-200 rounded-box p-3">
                <div className="stat-title text-xs">{t("colMessages")}</div>
                <div className="stat-value text-xl">
                  {formatInt(row.msgCount, lang)}
                </div>
                <div className="stat-desc">
                  {formatInt(row.sessionCount, lang)} {t("colSessions")}
                </div>
              </div>
              <div className="stat bg-base-200 rounded-box p-3">
                <div className="stat-title text-xs">{t("colLastActivity")}</div>
                <div className="mt-1 text-sm">
                  {formatRelative(row.lastActivityAt, lang)}
                </div>
                <div
                  className="truncate text-xs text-base-content/60"
                  title={row.directory}
                >
                  {row.directory}
                </div>
              </div>
              <div className="col-span-2 lg:col-span-4">
                <div className="mb-1 text-xs opacity-70">
                  {t("colTokenMix")}
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full">
                  {segTotal > 0 &&
                    segments.map((s) => (
                      <div
                        key={s.key}
                        className={s.color}
                        style={{ width: `${(s.value / segTotal) * 100}%` }}
                        title={`${t(s.key)}: ${formatTokens(s.value)}`}
                      />
                    ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs opacity-70">
                  {segments.map((s) => (
                    <span key={s.key} className="flex items-center gap-1">
                      <span className={`inline-block size-2 rounded-sm ${s.color}`} />
                      {t(s.key)}: {formatTokens(s.value)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
