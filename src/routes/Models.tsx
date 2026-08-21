/**
 * Models ("/models")
 *  - Sortable table of getModelBreakdown() (provider / model / family / tokens / cost / cache ratio)
 *  - Two donut charts: token share by provider and by family
 *  - Two top-10 bar charts: by volume and by cost (separate cards)
 *  - Price-analysis table (effective vs. list price)
 *  - Enrichment via @opencode-ai/models (Models.make().providers()), loaded once
 *    client-side; on failure we fall back to the DB-provided names.
 *  - Filters (provider / model / family / free) persisted in the URL via
 *    react-router useSearchParams so every combination is shareable/bookmarkable.
 */

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "react-router";
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
import type { ModelCost, ProviderMap } from "@opencode-ai/models";
import {
  detectManufacturer,
  OTHER_MANUFACTURER,
} from "../lib/manufacturers";
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

type SortKey = "msgCount" | "cost" | "tokens" | "totalTokens";
type SortDir = "asc" | "desc";
type FreeFilter = "all" | "only" | "paid";
type PriceSortKey = "model" | "totalTokens" | "effective" | "theo";
type PriceSortDir = "asc" | "desc";

export default function Models() {
  const api = usePoll(getModelBreakdown);
  const meta = useModelProviders();
  const [searchParams, setSearchParams] = useSearchParams();

  const provider = searchParams.get("provider") ?? "";
  const model = searchParams.get("model") ?? "";
  const family = searchParams.get("family") ?? "";
  const manufacturer = searchParams.get("manufacturer") ?? "";
  const free = (searchParams.get("free") as FreeFilter | null) ?? "all";

  const setParam = (key: string, value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: false },
    );
  };

  const hasFilter =
    !!provider ||
    !!model.trim() ||
    !!family ||
    !!manufacturer ||
    free !== "all";

  const resetFilters = () => setSearchParams(new URLSearchParams());

  const filtered = useMemo(() => {
    const m = model.trim().toLowerCase();
    return (api.data ?? []).filter((r) => {
      if (provider && r.providerId !== provider) return false;
      if (family && (r.family ?? "") !== family) return false;
      if (manufacturer && detectManufacturer(r.modelId) !== manufacturer)
        return false;
      if (m) {
        if (
          !r.modelId.toLowerCase().includes(m) &&
          !r.modelName.toLowerCase().includes(m)
        )
          return false;
      }
      if (free === "only" && r.cost !== 0) return false;
      if (free === "paid" && r.cost === 0) return false;
      return true;
    });
  }, [api.data, provider, model, family, manufacturer, free]);

  // Distinct providers / families for the filter selects (driven by full data).
  const providers = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of api.data ?? []) map.set(r.providerId, r.providerName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [api.data]);
  const families = useMemo(() => {
    const set = new Set<string>();
    for (const r of api.data ?? []) if (r.family) set.add(r.family);
    return [...set].sort();
  }, [api.data]);
  const manufacturers = useMemo(() => {
    const set = new Set<string>();
    for (const r of api.data ?? []) set.add(detectManufacturer(r.modelId));
    return [...set].sort();
  }, [api.data]);
  const modelIds = useMemo(
    () => [...new Set((api.data ?? []).map((r) => r.modelId))].sort(),
    [api.data],
  );

  const providerName = (id: string) =>
    providers.find(([pid]) => pid === id)?.[1] ?? id;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t("routeModels")}</h1>

      {meta.loading && (
        <p className="text-sm text-base-content/60">{t("modelsMetaLoading")}</p>
      )}
      {meta.error && (
        <p className="text-sm text-warning">{t("modelsMetaError")}</p>
      )}

      <ModelFilters
        provider={provider}
        model={model}
        family={family}
        manufacturer={manufacturer}
        free={free}
        providers={providers}
        families={families}
        manufacturers={manufacturers}
        modelIds={modelIds}
        providerName={providerName}
        hasFilter={hasFilter}
        onProvider={(v) => setParam("provider", v)}
        onModel={(v) => setParam("model", v)}
        onFamily={(v) => setParam("family", v)}
        onManufacturer={(v) => setParam("manufacturer", v)}
        onFree={(v) => setParam("free", v === "all" ? "" : v)}
        onReset={resetFilters}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title={t("modelsByProvider")}
          height={300}
          empty={filtered.length === 0}
        >
          <DonutChart
            loading={api.loading}
            error={api.error}
            onRetry={api.refetch}
            rows={filtered}
            meta={meta.providers}
            groupKey="providerId"
          />
        </ChartCard>
        <ChartCard
          title={t("modelsByFamily")}
          height={300}
          empty={filtered.length === 0}
        >
          <DonutChart
            loading={api.loading}
            error={api.error}
            onRetry={api.refetch}
            rows={filtered}
            meta={meta.providers}
            groupKey="family"
          />
        </ChartCard>
        <ChartCard
          title={t("modelsByManufacturer")}
          height={300}
          empty={filtered.length === 0}
        >
          <DonutChart
            loading={api.loading}
            error={api.error}
            onRetry={api.refetch}
            rows={filtered}
            meta={meta.providers}
            groupKey="manufacturer"
          />
        </ChartCard>
      </div>

      <TopModelsChart
        api={api}
        rows={filtered}
        meta={meta.providers}
        mode="volume"
      />
      <TopModelsChart api={api} rows={filtered} meta={meta.providers} mode="cost" />

      <ModelsPriceAnalysis api={api} rows={filtered} meta={meta.providers} />

      <ModelTable api={api} rows={filtered} meta={meta.providers} />
    </div>
  );
}

// --- Filters (URL-persisted) ---

function ModelFilters({
  provider,
  model,
  family,
  manufacturer,
  free,
  providers,
  families,
  manufacturers,
  modelIds,
  providerName,
  hasFilter,
  onProvider,
  onModel,
  onFamily,
  onManufacturer,
  onFree,
  onReset,
}: {
  provider: string;
  model: string;
  family: string;
  manufacturer: string;
  free: FreeFilter;
  providers: [string, string][];
  families: string[];
  manufacturers: string[];
  modelIds: string[];
  providerName: (id: string) => string;
  hasFilter: boolean;
  onProvider: (v: string) => void;
  onModel: (v: string) => void;
  onFamily: (v: string) => void;
  onManufacturer: (v: string) => void;
  onFree: (v: FreeFilter) => void;
  onReset: () => void;
}) {
  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="form-control w-auto">
            <span className="label-text text-sm opacity-70">
              {t("filterProvider")}
            </span>
            <select
              className="select select-bordered select-sm"
              value={provider}
              onChange={(e) => onProvider(e.target.value)}
            >
              <option value="">{t("filterAll")}</option>
              {providers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-control w-auto">
            <span className="label-text text-sm opacity-70">
              {t("filterModel")}
            </span>
            <input
              type="text"
              className="input input-bordered input-sm"
              placeholder={t("filterModelPlaceholder")}
              value={model}
              list="model-id-options"
              onChange={(e) => onModel(e.target.value)}
            />
            <datalist id="model-id-options">
              {modelIds.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>

          <label className="form-control w-auto">
            <span className="label-text text-sm opacity-70">
              {t("filterManufacturer")}
            </span>
            <select
              className="select select-bordered select-sm"
              value={manufacturer}
              onChange={(e) => onManufacturer(e.target.value)}
            >
              <option value="">{t("filterAll")}</option>
              {manufacturers.map((m) => (
                <option key={m} value={m}>
                  {manufacturerLabel(m)}
                </option>
              ))}
            </select>
          </label>

          <label className="form-control w-auto">
            <span className="label-text text-sm opacity-70">
              {t("filterFamily")}
            </span>
            <select
              className="select select-bordered select-sm"
              value={family}
              onChange={(e) => onFamily(e.target.value)}
            >
              <option value="">{t("filterAll")}</option>
              {families.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label className="form-control w-auto">
            <span className="label-text text-sm opacity-70">
              {t("filterFree")}
            </span>
            <select
              className="select select-bordered select-sm"
              value={free}
              onChange={(e) => onFree(e.target.value as FreeFilter)}
            >
              <option value="all">{t("filterAll")}</option>
              <option value="paid">{t("filterFreePaid")}</option>
              <option value="only">{t("filterFreeOnly")}</option>
            </select>
          </label>

          {hasFilter && (
            <button className="btn btn-sm btn-ghost" onClick={onReset}>
              {t("filterReset")}
            </button>
          )}
        </div>

        {hasFilter && (
          <div className="flex flex-wrap gap-2">
            {provider && (
              <FilterBadge
                label={`${t("filterProvider")}: ${providerName(provider)}`}
                onClear={() => onProvider("")}
              />
            )}
            {model.trim() && (
              <FilterBadge
                label={`${t("filterModel")}: ${model.trim()}`}
                onClear={() => onModel("")}
              />
            )}
            {family && (
              <FilterBadge
                label={`${t("filterFamily")}: ${family}`}
                onClear={() => onFamily("")}
              />
            )}
            {free !== "all" && (
              <FilterBadge
                label={`${t("filterFree")}: ${
                  free === "only" ? t("filterFreeOnly") : t("filterFreePaid")
                }`}
                onClear={() => onFree("all")}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterBadge({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="badge badge-primary gap-1">
      {label}
      <button
        type="button"
        className="cursor-pointer text-xs leading-none"
        onClick={onClear}
        aria-label="remove"
      >
        ✕
      </button>
    </span>
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

/** Total token volume of a model row (input + output + reasoning + cache read). */
function modelVolume(r: ModelBreakdownRow): number {
  return (
    r.inputTokens + r.outputTokens + r.reasoningTokens + r.cacheReadTokens
  );
}

/**
 * Top-10 models bar chart, rendered once per mode (Volumen and Kosten) as two
 * separate cards. The card title reflects the mode and shows the sum of the
 * displayed top-10 values as a subtitle.
 */
function TopModelsChart({
  api,
  rows,
  meta,
  mode,
}: {
  api: ReturnType<typeof usePoll<ModelBreakdownRow[]>>;
  rows: ModelBreakdownRow[];
  meta: ProviderMap | null;
  mode: "volume" | "cost";
}) {
  const top = (() => {
    const sorted = [...rows]
      .sort((a, b) =>
        mode === "volume" ? modelVolume(b) - modelVolume(a) : b.cost - a.cost,
      )
      .slice(0, 10);
    return sorted.map((r) => ({
      name: modelNameOnly(r, meta),
      value: mode === "volume" ? modelVolume(r) : r.cost,
    }));
  })();

  const total = top.reduce((s, d) => s + d.value, 0);
  const totalLabel = mode === "volume" ? formatTokens(total) : formatCost(total);

  return (
    <ChartCard
      title={mode === "volume" ? t("modelsTopVolume") : t("modelsTopCost")}
      height={320}
      subtitle={
        <span>
          {t("cardTotal")}: {totalLabel}
        </span>
      }
      empty={rows.length === 0}
    >
      <AsyncState loading={api.loading} error={api.error} onRetry={api.refetch}>
        {(() => {
          if (top.length === 0) return <EmptyState />;
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
                  width={180}
                  fontSize={10}
                  interval={0}
                />
                <Tooltip
                  formatter={(value) =>
                    mode === "volume"
                      ? formatTokens(Number(value ?? 0))
                      : formatCost(Number(value ?? 0))
                  }
                />
                <Bar
                  dataKey="value"
                  name={
                    mode === "volume" ? t("kpiTotalTokens") : t("kpiCost")
                  }
                  fill="var(--color-primary)"
                />
              </BarChart>
            </ResponsiveContainer>
          );
        })()}
      </AsyncState>
    </ChartCard>
  );
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
  rows: ModelBreakdownRow[];
  meta: ProviderMap | null;
  groupKey: "providerId" | "family" | "manufacturer";
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
              : groupKey === "manufacturer"
                ? detectManufacturer(r.modelId)
                : resolveRow(r, meta).family ?? t("seriesOther");          const total =
            r.inputTokens +
            r.outputTokens +
            r.reasoningTokens +
            r.cacheReadTokens;
          totals.set(key, (totals.get(key) ?? 0) + total);
        }
        const data = [...totals.entries()]
          .map(([k, value]) => ({
            name:
              groupKey === "manufacturer" ? manufacturerLabel(k) : k,
            value,
          }))
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

function ModelTable({
  api,
  rows,
  meta,
}: {
  api: ReturnType<typeof usePoll<ModelBreakdownRow[]>>;
  rows: ModelBreakdownRow[];
  meta: ProviderMap | null;
}) {
  const lang = useLang();
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const val = (r: ModelBreakdownRow): number =>
      sortKey === "totalTokens"
        ? r.inputTokens + r.outputTokens + r.reasoningTokens
        : sortKey === "msgCount"
          ? r.msgCount
          : sortKey === "cost"
            ? r.cost
            : r.inputTokens + r.outputTokens + r.reasoningTokens + r.cacheReadTokens;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (val(a) - val(b)) * dir);
  }, [rows, sortKey, sortDir]);

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
            <p className="text-base-content/60">{t("modelsFilterEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>{t("colProvider")}</th>
                    <th>{t("colModel")}</th>
                    <th>{t("colFamily")}</th>
                    <th>{t("colManufacturer")}</th>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggle("totalTokens")}
                    >
                      {t("colTotalTokens")}
                      {arrow("totalTokens")}
                    </th>
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
                        <td>{manufacturerLabel(detectManufacturer(r.modelId))}</td>
                        <td className="text-right font-medium">
                          {formatTokens(
                            r.inputTokens + r.outputTokens + r.reasoningTokens,
                          )}
                        </td>
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

/** Format a per-1M-token price (already in $/1M from the snapshot) as "$X.XX". */
function formatPricePerM(price: number | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return formatCost(price);
}

function ModelsPriceAnalysis({
  api,
  rows,
  meta,
}: {
  api: ReturnType<typeof usePoll<ModelBreakdownRow[]>>;
  rows: ModelBreakdownRow[];
  meta: ProviderMap | null;
}) {
  const [sortKey, setSortKey] =
    useState<PriceSortKey>("effective");
  const [sortDir, setSortDir] = useState<PriceSortDir>("desc");

  // Enrich + filter (unsorted) — the source of truth for the footer totals.
  const enriched = useMemo(() => {
    return rows
      .map((r) => {
        const tokens =
          r.inputTokens +
          r.outputTokens +
          r.reasoningTokens +
          r.cacheReadTokens +
          r.cacheWriteTokens;
        const effective = tokens > 0 ? (r.cost / tokens) * 1e6 : 0;
        const cost = meta?.[r.providerId]?.models?.[r.modelId]?.cost as
          | ModelCost
          | undefined;
        const mix = {
          input: r.inputTokens,
          cacheRead: r.cacheReadTokens,
          output: r.outputTokens,
          reasoning: r.reasoningTokens,
          // Kein expliziter cache_write-Preis => Input-Preis (kein Aufpreis)
          cacheWrite: r.cacheWriteTokens,
        };
        const rates = {
          input: cost?.input ?? 0,
          cacheRead: cost?.cache_read ?? 0,
          // Reasoning zum Output-Satz, falls nicht explizit gelistet
          output: cost?.output ?? 0,
          reasoning: cost?.reasoning ?? cost?.output ?? 0,
          cacheWrite: cost?.cache_write ?? cost?.input ?? 0,
        };
        const theo =
          (mix.input * rates.input +
            mix.cacheRead * rates.cacheRead +
            mix.output * rates.output +
            mix.reasoning * rates.reasoning +
            mix.cacheWrite * rates.cacheWrite) /
          1e6;
        const totalTokens =
          r.inputTokens +
          r.outputTokens +
          r.reasoningTokens +
          r.cacheWriteTokens;
        return { r, tokens, effective, cost, theo, totalTokens };
      })
      .filter((d) => d.tokens > 0);
  }, [rows, meta]);

  // Sort the enriched rows on the computed values BEFORE rendering.
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...enriched].sort((a, b) => {
      switch (sortKey) {
        case "model":
          return (
            modelNameOnly(a.r, meta).localeCompare(
              modelNameOnly(b.r, meta),
            ) * dir
          );
        case "totalTokens":
          return (a.totalTokens - b.totalTokens) * dir;
        case "theo":
          return (a.theo - b.theo) * dir;
        case "effective":
        default:
          return (a.effective - b.effective) * dir;
      }
    });
  }, [enriched, sortKey, sortDir, meta]);

  const toggle = (key: PriceSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const arrow = (key: PriceSortKey) =>
    key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // Footer always reflects ALL filtered rows, independent of sort order.
  const totals = useMemo(() => {
    const sumCost = enriched.reduce((s, d) => s + d.r.cost, 0);
    const sumTokens = enriched.reduce((s, d) => s + d.tokens, 0);
    const avg = sumTokens > 0 ? (sumCost / sumTokens) * 1e6 : 0;
    return { sumCost, sumTokens, avg };
  }, [enriched]);

  return (
    <div className="card bg-base-200 shadow-sm">
      <div className="card-body gap-2">
        <h2 className="card-title text-base">{t("priceAnalysis")}</h2>
        <AsyncState
          loading={api.loading}
          error={api.error}
          onRetry={api.refetch}
        >
          {sorted.length === 0 ? (
            <p className="text-base-content/60">{t("modelsFilterEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggle("model")}
                    >
                      {t("colModel")}
                      {arrow("model")}
                    </th>
                    <th>{t("colTokenMix")}</th>
                    <th>{t("colListPrice")}</th>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggle("effective")}
                    >
                      {t("colEffectivePrice")}
                      {arrow("effective")}
                    </th>
                    <th
                      className="cursor-pointer select-none"
                      onClick={() => toggle("theo")}
                    >
                      {t("colTheoPrice")}
                      {arrow("theo")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ r, effective, cost, theo }) => (
                    <tr key={`${r.providerId}-${r.modelId}`}>
                      <td>
                        <div className="font-medium">
                          {modelNameOnly(r, meta)}
                        </div>
                        <div className="text-[10px] opacity-60">
                          {r.providerName}
                        </div>
                      </td>
                      <td className="text-right text-xs">
                        <div>In {formatRatio(pct(r.inputTokens, r))}</div>
                        <div>CR {formatRatio(pct(r.cacheReadTokens, r))}</div>
                        <div>
                          Out {formatRatio(pct(r.outputTokens + r.reasoningTokens, r))}
                        </div>
                        {r.cacheWriteTokens > 0 && (
                          <div>CW {formatRatio(pct(r.cacheWriteTokens, r))}</div>
                        )}
                      </td>
                      <td className="text-right text-xs">
                        <div>{t("priceInput")}: {formatPricePerM(cost?.input)}</div>
                        <div>
                          {t("priceCacheRead")}: {formatPricePerM(cost?.cache_read)}
                        </div>
                        <div>
                          {t("priceOutput")}: {formatPricePerM(cost?.output)}
                        </div>
                        {cost?.cache_write != null && (
                          <div>
                            {t("priceCacheWrite")}:{" "}
                            {formatPricePerM(cost.cache_write)}
                          </div>
                        )}
                      </td>
                      <td className="text-right font-medium text-primary">
                        {formatCost(effective)}
                        <span className="text-[10px] opacity-60">
                          {" "}
                          {t("pricePerM")}
                        </span>
                      </td>
                      <td className="text-right">
                        {formatCost(theo)}
                        <span className="text-[10px] opacity-60">
                          {" "}
                          {t("pricePerM")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t-2 border-base-300">
                    <td colSpan={3}>{t("footerAvgPrice")}</td>
                    <td className="text-right text-primary">
                      {formatCost(totals.avg)}
                      <span className="text-[10px] opacity-60">
                        {" "}
                        {t("pricePerM")}
                      </span>
                    </td>
                    <td className="text-right">
                      {formatCost(totals.sumCost)} ·{" "}
                      {formatTokens(totals.sumTokens)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </AsyncState>
      </div>
    </div>
  );
}

/** Lokalisierter Hersteller-Name: "Other" → i18n (seriesOther), Rest kanonisch. */
function manufacturerLabel(key: string): string {
  return key === OTHER_MANUFACTURER ? t("seriesOther") : key;
}

function pct(part: number, r: ModelBreakdownRow): number {  const sum =
    r.inputTokens +
    r.outputTokens +
    r.reasoningTokens +
    r.cacheReadTokens +
    r.cacheWriteTokens;
  return sum > 0 ? part / sum : 0;
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
