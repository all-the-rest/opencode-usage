/**
 * Models ("/models")
 *  - Sortable table of getModelBreakdown() (provider / model / family / tokens / cost / cache ratio)
 *  - Two donut charts: token share by provider and by family
 *  - Bar chart: top 10 models by cost
 *  - Enrichment via @opencode-ai/models (Models.make().providers()), loaded once
 *    client-side; on failure we fall back to the DB-provided names.
 */

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Models as ModelsClient } from "@opencode-ai/models";
import type { ProviderMap } from "@opencode-ai/models";
import { getModelBreakdown, usePoll } from "../lib/api";
import type { ModelBreakdownRow } from "../lib/types";
import {
  formatCost,
  formatInt,
  formatRatio,
  formatTokens,
} from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { AsyncState, EmptyState } from "../components/Async";
import { ChartCard } from "../components/ChartCard";
import { paletteColor } from "../components/colors";

type SortKey = "msgCount" | "cost" | "tokens";
type SortDir = "asc" | "desc";

export default function Models() {
  const api = usePoll(getModelBreakdown);
  const meta = useModelProviders();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("routeModels")}</h1>

      {meta.loading && (
        <p className="text-sm text-base-content/60">{t("modelsMetaLoading")}</p>
      )}
      {meta.error && (
        <p className="text-sm text-warning">{t("modelsMetaError")}</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title={t("modelsByProvider")}
          height={300}
          empty={(api.data?.length ?? 0) === 0}
        >
          <DonutChart
            loading={api.loading}
            error={api.error}
            onRetry={api.refetch}
            rows={api.data}
            meta={meta.providers}
            groupKey="providerId"
          />
        </ChartCard>
        <ChartCard
          title={t("modelsByFamily")}
          height={300}
          empty={(api.data?.length ?? 0) === 0}
        >
          <DonutChart
            loading={api.loading}
            error={api.error}
            onRetry={api.refetch}
            rows={api.data}
            meta={meta.providers}
            groupKey="family"
          />
        </ChartCard>
      </div>

      <ChartCard
        title={t("modelsTopCost")}
        height={320}
        empty={(api.data?.length ?? 0) === 0}
      >
        <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
          {(() => {
            const rows = api.data ?? [];
            if (rows.length === 0) return <EmptyState />;
            const top = [...rows]
              .sort((a, b) => b.cost - a.cost)
              .slice(0, 10)
              .map((r) => ({
                name: modelNameOnly(r, meta.providers),
                cost: r.cost,
              }));
            return (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={top}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-base-300"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => formatCost(Number(v))}
                    fontSize={11}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={180}
                    fontSize={10}
                    interval={0}
                  />
                  <Tooltip
                    formatter={(value) => formatCost(Number(value ?? 0))}
                  />
                  <Bar
                    dataKey="cost"
                    name={t("kpiCost")}
                    fill="var(--color-primary)"
                  />
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </AsyncState>
      </ChartCard>

      <ModelTable api={api} meta={meta.providers} />
    </div>
  );
}

function useModelProviders() {
  const [providers, setProviders] = useState<ProviderMap | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ModelsClient.make()
      .providers()
      .then((p) => {
        if (cancelled) return;
        setProviders(p);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, loading, error };
}

function modelNameOnly(r: ModelBreakdownRow, meta: ProviderMap | null): string {
  const mdl = meta?.[r.providerId]?.models?.[r.modelId];
  return mdl?.name ?? r.modelName;
}

function resolveRow(r: ModelBreakdownRow, meta: ProviderMap | null) {
  const prov = meta?.[r.providerId];
  const mdl = prov?.models?.[r.modelId];
  return {
    providerName: prov?.name ?? r.providerName,
    modelName: mdl?.name ?? r.modelName,
    family: mdl?.family ?? r.family,
    contextWindow: mdl?.limit?.context ?? r.contextWindow,
  };
}

function DonutChart({
  loading,
  error,
  onRetry,
  rows,
  meta,
  groupKey,
}: {
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  rows: ModelBreakdownRow[] | null;
  meta: ProviderMap | null;
  groupKey: "providerId" | "family";
}) {
  return (
    <AsyncState loading={loading} error={error} onRetry={onRetry}>
      {(() => {
        const list = rows ?? [];
        if (list.length === 0) return <EmptyState />;
        const totals = new Map<string, number>();
        for (const r of list) {
          const key =
            groupKey === "providerId"
              ? resolveRow(r, meta).providerName
              : resolveRow(r, meta).family ?? t("seriesOther");
          const total =
            r.inputTokens +
            r.outputTokens +
            r.reasoningTokens +
            r.cacheReadTokens;
          totals.set(key, (totals.get(key) ?? 0) + total);
        }
        const data = [...totals.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10);
        const sum = data.reduce((acc, d) => acc + d.value, 0) || 1;
        return (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={1}
                  >
                    {data.map((_, i) => (
                      <Cell key={i} fill={paletteColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatTokens(Number(value ?? 0))}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px]">
              {data.map((d, i) => (
                <li key={d.name} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: paletteColor(i) }}
                  />
                  <span className="max-w-[10rem] truncate">{d.name}</span>
                  <span className="text-base-content/60">
                    {Math.round((d.value / sum) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </AsyncState>
  );
}

function ModelTable({
  api,
  meta,
}: {
  api: ReturnType<typeof usePoll<ModelBreakdownRow[]>>;
  meta: ProviderMap | null;
}) {
  const lang = useLang();
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const rows = api.data ?? [];
    const val = (r: ModelBreakdownRow): number =>
      sortKey === "msgCount"
        ? r.msgCount
        : sortKey === "cost"
          ? r.cost
          : r.inputTokens + r.outputTokens + r.reasoningTokens + r.cacheReadTokens;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (val(a) - val(b)) * dir);
  }, [api.data, sortKey, sortDir]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const arrow = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body gap-2">
        <h2 className="card-title text-base">{t("modelsBreakdown")}</h2>
        <AsyncState
          loading={api.loading}
          error={api.error}
          onRetry={api.refetch}
        >
          {sorted.length === 0 ? (
            <p className="text-base-content/60">{t("stateNoData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>{t("colProvider")}</th>
                    <th>{t("colModel")}</th>
                    <th>{t("colFamily")}</th>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggle("msgCount")}
                    >
                      {t("colMessages")}
                      {arrow("msgCount")}
                    </th>
                    <th>{t("tokInput")}</th>
                    <th>{t("tokOutput")}</th>
                    <th>{t("tokCacheRead")}</th>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggle("cost")}
                    >
                      {t("colCost")}
                      {arrow("cost")}
                    </th>
                    <th>{t("colCacheRatio")}</th>
                    <th>{t("modelsContext")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, idx) => {
                    const info = resolveRow(r, meta);
                    return (
                      <tr key={`${r.providerId}-${r.modelId}-${idx}`}>
                        <td>{info.providerName}</td>
                        <td>{info.modelName}</td>
                        <td>{info.family ?? "—"}</td>
                        <td className="text-right">
                          {formatInt(r.msgCount, lang)}
                        </td>
                        <td className="text-right">
                          {formatTokens(r.inputTokens)}
                        </td>
                        <td className="text-right">
                          {formatTokens(r.outputTokens)}
                        </td>
                        <td className="text-right">
                          {formatTokens(r.cacheReadTokens)}
                        </td>
                        <td className="text-right">{formatCost(r.cost)}</td>
                        <td>
                          <CacheRatio ratio={r.cacheHitRatio} />
                        </td>
                        <td className="text-right">
                          {info.contextWindow != null
                            ? `${formatTokens(info.contextWindow)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AsyncState>
      </div>
    </div>
  );
}

function CacheRatio({ ratio }: { ratio: number }) {
  const pct = Math.round((Number.isFinite(ratio) ? ratio : 0) * 100);
  if (pct === 0) {
    return <span className="badge badge-ghost badge-sm">{pct}%</span>;
  }
  return (
    <div
      className="radial-progress text-primary text-[10px]"
      style={
        {
          "--value": pct,
          "--size": "2.2rem",
          "--thickness": "3px",
        } as CSSProperties
      }
      role="img"
      aria-label={formatRatio(ratio)}
    >
      {pct}%
    </div>
  );
}
