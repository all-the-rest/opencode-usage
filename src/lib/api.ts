/**
 * Typed fetch layer for the opencode-usage Hono API.
 *
 * Base URL is "" so requests resolve same-origin (Vite dev proxy maps /api to
 * localhost:3712, and `pnpm start` serves the API + static dist/ together).
 */

import { useEffect, useRef, useState } from "react";
import type {
  CacheAnalysis,
  Granularity,
  GroupBy,
  HeatmapCell,
  MetaInfo,
  ModelBreakdownRow,
  ProjectRow,
  SessionRow,
  Summary,
  TimeseriesResponse,
} from "./types";

const BASE_URL = "";

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { signal });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status} ${res.statusText})`);
  }
  return (await res.json()) as T;
}

// --- Endpoint functions for every contract type in ./types.ts ---

export function getSummary(signal?: AbortSignal): Promise<Summary> {
  return request<Summary>("/api/stats/summary", signal);
}

export function getTimeseries(
  granularity: Granularity,
  groupBy: GroupBy,
  signal?: AbortSignal,
): Promise<TimeseriesResponse> {
  const params = new URLSearchParams({ granularity, groupBy });
  return request<TimeseriesResponse>(`/api/stats/timeseries?${params}`, signal);
}

export function getModelBreakdown(signal?: AbortSignal): Promise<ModelBreakdownRow[]> {
  return request<ModelBreakdownRow[]>("/api/stats/models", signal);
}

export function getProjects(signal?: AbortSignal): Promise<ProjectRow[]> {
  return request<ProjectRow[]>("/api/stats/projects", signal);
}

export type SessionSort =
  | "recent"
  | "timeCreated"
  | "timeUpdated"
  | "cost"
  | "msgCount"
  | "cacheHitRatio"
  | "title"
  | "tokens";

export interface SessionQuery {
  limit?: number;
  offset?: number;
  sort?: SessionSort;
  dir?: "asc" | "desc";
}

export function getSessions(
  query: SessionQuery = {},
  signal?: AbortSignal,
): Promise<SessionRow[]> {
  const params = new URLSearchParams();
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  if (query.sort != null) params.set("sort", query.sort);
  if (query.dir != null) params.set("dir", query.dir);
  const qs = params.toString();
  return request<SessionRow[]>(`/api/stats/sessions${qs ? `?${qs}` : ""}`, signal);
}

export function getCacheAnalysis(
  minMessages = 20,
  signal?: AbortSignal,
): Promise<CacheAnalysis> {
  const params = new URLSearchParams();
  params.set("minMessages", String(minMessages));
  return request<CacheAnalysis>(
    `/api/stats/cache-analysis?${params}`,
    signal,
  );
}

export function getHeatmap(signal?: AbortSignal): Promise<HeatmapCell[]> {
  return request<HeatmapCell[]>("/api/stats/heatmap", signal);
}

export function getMeta(signal?: AbortSignal): Promise<MetaInfo> {
  return request<MetaInfo>("/api/stats/meta", signal);
}

// --- React hooks ---

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Fetch `fetcher` on mount and expose loading/error state plus a `refetch`.
 * The in-flight request is aborted on unmount / refetch to avoid races.
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => controller.abort();
  }, [nonce]);

  const refetch = () => setNonce((n) => n + 1);

  return { data, loading, error, refetch };
}

/**
 * Like `useApi`, but also re-runs the fetcher on a fixed interval (default 60s)
 * in addition to the immediate fetch on mount.
 */
export function usePoll<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs = 60_000,
): ApiState<T> {
  const api = useApi(fetcher);
  const refetchRef = useRef(api.refetch);
  refetchRef.current = api.refetch;

  useEffect(() => {
    const id = setInterval(() => refetchRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return api;
}
