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

export default function Projects() {
  const api = usePoll(getProjects);
  const lang = useLang();
  const [mode, setMode] = useState<ViewMode>("volume");

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
              return (
                <div className="overflow-x-auto">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr>
                        <th>{t("colProject")}</th>
                        <th>{t("colDirectory")}</th>
                        <th className="text-right">{t("colSessions")}</th>
                        <th className="text-right">{t("colMessages")}</th>
                        <th className="text-right">{t("colTokens")}</th>
                        <th className="text-right">{t("kpiCost")}</th>
                        <th>{t("colLastActivity")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((p) => (
                        <tr key={p.projectId}>
                          <td className="font-medium">
                            {p.name ?? t("projectNone")}
                          </td>
                          <td
                            className="max-w-[16rem] truncate text-base-content/70"
                            title={p.directory}
                          >
                            {basename(p.directory)}
                          </td>
                          <td className="text-right">
                            {formatInt(p.sessionCount, lang)}
                          </td>
                          <td className="text-right">
                            {formatInt(p.msgCount, lang)}
                          </td>
                          <td className="text-right">
                            {formatTokens(
                              p.inputTokens +
                                p.outputTokens +
                                p.reasoningTokens +
                                p.cacheReadTokens,
                            )}
                          </td>
                          <td className="text-right">{formatCost(p.cost)}</td>
                          <td className="text-base-content/70">
                            {formatRelative(p.lastActivityAt, lang)}
                          </td>
                        </tr>
                      ))}
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
