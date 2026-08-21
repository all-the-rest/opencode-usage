/**
 * Drill-down section for a single day (dashboard URL param `day=YYYY-MM-DD`).
 *
 * Shows KPIs, an hourly message histogram, compact by-model / by-project
 * tables and the sessions active that day. Respects the global project
 * filter (`project` prop -> FetchOpts). The parent must remount this
 * component when date/project change (React key), because usePoll only
 * refetches on mount/interval.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDayDetail, usePoll } from "../lib/api";
import type { Lang } from "../lib/i18n";
import { t, useLang } from "../lib/i18n";
import {
  basename,
  formatCost,
  formatInt,
  formatSessionTitle,
  formatTokens,
} from "../lib/format";
import { AsyncState } from "./Async";
import { KpiCard } from "./KpiCard";

const LOCALE: Record<Lang, string> = { de: "de-DE", en: "en-US" };

/** Short time-of-day label for session rows ("14:32"). */
function formatTimeShort(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeStyle: "short",
  }).format(new Date(ms));
}

export default function DayDetailSection({
  date,
  project,
  onClose,
}: {
  date: string;
  project?: string;
  onClose: () => void;
}) {
  const api = usePoll((signal) => getDayDetail(date, signal, { project }));
  const lang = useLang();
  const d = api.data;

  // Tokens consistent with the rest of the dashboard: in + out + reasoning.
  const totalTokens = d
    ? d.inputTokens + d.outputTokens + d.reasoningTokens
    : 0;

  // Top 8 models by total tokens for the compact table.
  const topModels = d
    ? [...d.byModel]
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 8)
    : [];

  // Full 24-hour axis, zero-filled from the sparse byHour payload.
  const hourRows = (() => {
    const map = new Map<number, number>();
    for (const h of d?.byHour ?? []) map.set(h.hour, h.msgCount);
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      msgCount: map.get(hour) ?? 0,
    }));
  })();

  const sessions = d ? d.sessions.slice(0, 10) : [];
  const empty = d != null && d.msgCount === 0;

  return (
    <section className="card border border-primary/30 bg-base-200 shadow-sm">
      <div className="card-body gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="card-title text-base">{t("dayDetailTitle", { date })}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t("dayDetailClose")}
          </button>
        </div>

        <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
          {!d ? null : empty ? (
            <p className="py-6 text-center text-sm text-base-content/60">
              {t("dayDetailEmpty")}
            </p>
          ) : (
            <div className="space-y-4">
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KpiCard
                  label={t("kpiMessages")}
                  value={formatInt(d.msgCount, lang)}
                />
                <KpiCard
                  label={t("kpiTotalTokens")}
                  value={formatTokens(totalTokens)}
                />
                <KpiCard label={t("kpiCost")} value={formatCost(d.cost)} />
                <KpiCard
                  label={t("kpiSessions")}
                  value={formatInt(d.sessionCount, lang)}
                />
              </div>

              {/* Messages by hour */}
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hourRows}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-base-300"
                    />
                    <XAxis
                      dataKey="hour"
                      ticks={[0, 6, 12, 18, 23]}
                      fontSize={10}
                    />
                    <YAxis
                      tickFormatter={(v) => String(Number(v))}
                      fontSize={10}
                      width={32}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--color-base-content)", opacity: 0.08 }}
                      formatter={(value) =>
                        formatInt(Number(value ?? 0), lang)
                      }
                      labelFormatter={(l) => t("heatmapHour", { hour: Number(l) })}
                    />
                    <Bar
                      dataKey="msgCount"
                      name={t("colMessages")}
                      fill="var(--color-primary)"
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Compact tables: top models + projects */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-medium opacity-80">
                    {t("dayDetailByModel")}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>{t("colModel")}</th>
                          <th className="text-right">{t("colTokens")}</th>
                          <th className="text-right">{t("colCost")}</th>
                          <th className="text-right">{t("colMessages")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topModels.map((m) => (
                          <tr key={`${m.providerId}/${m.modelId}`}>
                            <td className="max-w-40 truncate" title={m.modelId}>
                              {m.modelId}
                            </td>
                            <td className="text-right tabular-nums">
                              {formatTokens(m.totalTokens)}
                            </td>
                            <td className="text-right tabular-nums">
                              {formatCost(m.cost)}
                            </td>
                            <td className="text-right tabular-nums">
                              {formatInt(m.msgCount, lang)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-sm font-medium opacity-80">
                    {t("dayDetailByProject")}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>{t("colProject")}</th>
                          <th className="text-right">{t("colTokens")}</th>
                          <th className="text-right">{t("colCost")}</th>
                          <th className="text-right">{t("colMessages")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.byProject.map((p) => (
                          <tr key={p.directory}>
                            <td
                              className="max-w-40 truncate"
                              title={p.directory}
                            >
                              {basename(p.directory)}
                            </td>
                            <td className="text-right tabular-nums">
                              {formatTokens(p.totalTokens)}
                            </td>
                            <td className="text-right tabular-nums">
                              {formatCost(p.cost)}
                            </td>
                            <td className="text-right tabular-nums">
                              {formatInt(p.msgCount, lang)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Sessions updated that day */}
              <div>
                <h3 className="mb-1 text-sm font-medium opacity-80">
                  {t("dayDetailSessions", { count: d.sessions.length })}
                </h3>
                <ul className="divide-y divide-base-300 rounded-box border border-base-300">
                  {sessions.map((s) => (
                    <li
                      key={s.sessionId}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate" title={s.title ?? undefined}>
                          {formatSessionTitle(s.title, lang)}
                        </div>
                        <div className="text-xs text-base-content/50">
                          {formatTimeShort(s.timeUpdated, lang)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-base-content/70">
                        <span className="badge badge-ghost badge-sm">
                          {formatInt(s.msgCount, lang)}
                        </span>
                        <span className="tabular-nums">{formatCost(s.cost)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </AsyncState>
      </div>
    </section>
  );
}
