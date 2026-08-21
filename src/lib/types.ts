/**
 * Shared API contract between Hono server and React frontend.
 * The analysis DB (data/stats.db) is built by scripts/extract.ts.
 */

export interface Summary {
  totalTokens: number; // = inputTokens + outputTokens + reasoningTokens (cache separat gezählt)
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  sessionCount: number;
  messageCount: number;
  avgCacheHitRatio: number; // weighted: sum(cache_read)/sum(input+cache_read+cache_write)
  firstMessageAt: number | null; // epoch ms
  lastMessageAt: number | null; // epoch ms
}

export interface TimeseriesPoint {
  day: string; // YYYY-MM-DD
  key: string; // group value: providerID, family, or "total"
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface ModelBreakdownRow {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  family: string | null;
  contextWindow: number | null;
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  cacheHitRatio: number;
}

export interface ProjectRow {
  projectId: string;
  directory: string;
  name: string | null;
  sessionCount: number;
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  lastActivityAt: number;
}

export interface SessionRow {
  sessionId: string;
  projectId: string;
  directory: string;
  title: string | null;
  modelId: string | null;
  agent: string | null;
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  cacheHitRatio: number;
  timeCreated: number;
  timeUpdated: number;
}

// sessions?sort=tokens sortiert nach input+output+reasoning (ohne cache).

export interface CacheAnalysisPoint {
  sessionId: string;
  title: string | null;
  msgCount: number;
  cacheHitRatio: number;
  totalTokens: number;
  cost: number;
}

export interface CacheAnalysis {
  points: CacheAnalysisPoint[];
  pearsonCorrelation: number | null; // msgCount vs cacheHitRatio
  linearFit: { slope: number; intercept: number } | null;
  bucketAverages: Array<{
    bucket: string; // "1-5", "6-10", "11-25", "26-50", "51-100", "101+"
    count: number; // sessions in bucket
    avgCacheHitRatio: number;
  }>;
}

export interface HeatmapCell {
  day: string; // YYYY-MM-DD
  hour: number; // 0-23
  msgCount: number;
  cost: number;
}

export interface MetaInfo {
  lastSync: number | null; // epoch ms of last extractor sync
  sourceDb: string;
  messageCount: number;
}

export type Granularity = "day" | "week" | "month";
export type GroupBy =
  | "provider"
  | "family"
  | "manufacturer"
  | "model"
  | "total";

// ---------------------------------------------------------------------------
// Global drill-down contract (todo 24):
// ALLE /api/stats/* Endpunkte akzeptieren optional ?dir=<basename> und
// filtern dann auf dieses Projekt-Verzeichnis. Ohne Parameter = global.
// ---------------------------------------------------------------------------

/** Tages-Detail für ?day=YYYY-MM-DD (Endpoint: GET /api/stats/day/:date). */
export interface DayDetail {
  date: string; // YYYY-MM-DD
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  sessionCount: number;
  byHour: Array<{ hour: number; msgCount: number }>;
  byModel: Array<{
    providerId: string;
    modelId: string;
    msgCount: number;
    totalTokens: number;
    cost: number;
  }>;
  byProject: Array<{
    directory: string;
    msgCount: number;
    totalTokens: number;
    cost: number;
  }>;
  sessions: SessionRow[]; // an diesem Tag aktualisierte Sessions
}

export interface TimeseriesResponse {
  points: TimeseriesPoint[];
}
