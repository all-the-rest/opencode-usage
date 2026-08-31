/**
 * opencode-usage API server.
 *
 * Hono + @hono/node-server. Serves the read-only analysis DB (data/stats.db)
 * through the endpoints defined in ../src/lib/types.ts and, when a production
 * build exists, the static frontend from dist/ with SPA fallback.
 *
 * Contract note: the response shapes below are dictated by src/lib/types.ts.
 * That file is NOT modified here; any proposed changes are noted in the report.
 */
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "node:fs";
import path from "node:path";
import {
  openDatabase,
  getDbError,
  resolveDbPath,
  num,
  cacheHitRatio,
  type DatabaseType,
} from "./db";
import { resolveModelMeta, familyKey } from "./metadata";
import {
  getShareData,
  renderShareCard,
  renderSharePng,
  type ShareLang,
  type ShareProjectsMode,
  type ShareRange,
} from "./share";
import { detectManufacturer } from "../src/lib/manufacturers";
import type {
  Summary,
  TimeseriesPoint,
  TimeseriesResponse,
  ModelBreakdownRow,
  ProjectRow,
  SessionRow,
  CacheAnalysis,
  CacheAnalysisPoint,
  HeatmapCell,
  MetaInfo,
  Granularity,
  GroupBy,
  DayDetail,
} from "../src/lib/types";

const PORT = Number(process.env.PORT ?? 3712);
const DIST_DIR = path.resolve(process.cwd(), "dist");

const app = new Hono();

/**
 * Wraps an API handler: returns 503 (with the DB error) when the read-only
 * stats.db cannot be opened, otherwise delegates to `fn(db)`.
 */
function handleApi(c: Context, fn: (db: DatabaseType) => Response): Response {
  const db = openDatabase();
  if (!db) {
    return c.json(
      { error: `stats.db is not available: ${getDbError() ?? "unknown error"}` },
      503,
    );
  }
  return fn(db);
}

/**
 * Global project filter (?project=<basename>). Matches the directory exactly
 * or as a path suffix ("tracking" also matches ".../dev/tracking").
 * NOTE: ?dir= is unrelated — it is the session sort direction (asc/desc).
 */
function projectFilter(
  project: string | undefined,
): { sql: string; params: string[] } {
  const d = project?.trim();
  if (!d) return { sql: "", params: [] };
  return {
    sql: " AND (directory = ? OR directory LIKE '%/' || ?)",
    params: [d, d],
  };
}

/**
 * Optional date-range query params (from/to, YYYY-MM-DD, local time). Returns
 * `ok: false` when only one is present or the format is invalid — callers then
 * respond 400. `hasRange` is true only when BOTH bounds are valid.
 */
function readRange(c: Context): {
  from: string | null;
  to: string | null;
  ok: boolean;
} {
  const from = c.req.query("from");
  const to = c.req.query("to");
  const ok =
    (from == null || /^\d{4}-\d{2}-\d{2}$/.test(from)) &&
    (to == null || /^\d{4}-\d{2}-\d{2}$/.test(to));
  return { from: from ?? null, to: to ?? null, ok };
}

// ---------------------------------------------------------------------------
// GET /api/stats/summary
// ---------------------------------------------------------------------------
interface SummaryRow {
  messageCount: number | null;
  totalCost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  firstMessageAt: number | null;
  lastMessageAt: number | null;
  sessionCount: number | null;
}

function validateDate(v: string | undefined): v is string {
  return v != null && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

app.get("/api/stats/summary", (c) =>
  handleApi(c, (db) => {
    const { sql, params } = projectFilter(c.req.query("project"));

    // Optional range (YYYY-MM-DD, local time). Used by the dashboard KPIs to
    // scope to the current month. Without both params the result is all-time.
    const from = c.req.query("from");
    const to = c.req.query("to");
    if ((from != null || to != null) && (!validateDate(from) || !validateDate(to))) {
      return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    }
    const hasRange = from != null && to != null;
    const rangeSql = hasRange
      ? " AND date(m.time_created / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?"
      : "";
    const rangeParams = hasRange ? [from!, to!] : [];

    const row = (
      sql
        ? db
            .prepare(
              `SELECT COUNT(*) AS messageCount,
                SUM(m.cost) AS totalCost,
                SUM(m.tokens_input) AS inputTokens,
                SUM(m.tokens_output) AS outputTokens,
                SUM(m.tokens_reasoning) AS reasoningTokens,
                SUM(m.cache_read) AS cacheReadTokens,
                SUM(m.cache_write) AS cacheWriteTokens,
                MIN(m.time_created) AS firstMessageAt,
                MAX(m.time_created) AS lastMessageAt,
                COUNT(DISTINCT m.session_id) AS sessionCount
          FROM messages m
          JOIN sessions_agg s ON s.session_id = m.session_id
          WHERE 1=1${sql}${rangeSql}`,
            )
            .get(...params, ...rangeParams)
        : db
            .prepare(
              `SELECT COUNT(*) AS messageCount,
                SUM(cost) AS totalCost,
                SUM(tokens_input) AS inputTokens,
                SUM(tokens_output) AS outputTokens,
                SUM(tokens_reasoning) AS reasoningTokens,
                SUM(cache_read) AS cacheReadTokens,
                SUM(cache_write) AS cacheWriteTokens,
                MIN(time_created) AS firstMessageAt,
                MAX(time_created) AS lastMessageAt,
                COUNT(DISTINCT session_id) AS sessionCount
          FROM messages m
          WHERE 1=1${rangeSql}`,
            )
            .get(...rangeParams)
    ) as SummaryRow | undefined;

    const input = num(row?.inputTokens);
    const output = num(row?.outputTokens);
    const reasoning = num(row?.reasoningTokens);
    const cacheRead = num(row?.cacheReadTokens);
    const cacheWrite = num(row?.cacheWriteTokens);

    const summary: Summary = {
      // Menschliche Entscheidung (2026-08-21): Gesamt-Tokens inkl. Cache Read,
      // konsistent mit Token-Zeitverlauf/-Tooltip.
      totalTokens: input + output + reasoning + cacheRead,
      inputTokens: input,
      outputTokens: output,
      reasoningTokens: reasoning,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalCost: num(row?.totalCost),
      sessionCount: num(row?.sessionCount),
      messageCount: num(row?.messageCount),
      avgCacheHitRatio: cacheHitRatio(input, cacheRead, cacheWrite),
      firstMessageAt: row?.firstMessageAt ?? null,
      lastMessageAt: row?.lastMessageAt ?? null,
    };
    return c.json(summary);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/stats/timeseries?granularity=day|week|month|all&groupBy=provider|family|model|manufacturer|total
// ---------------------------------------------------------------------------
interface DailyAggRow {
  day: string;
  provider_id: string;
  model_id: string;
  msg_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
}

/** Truncate a YYYY-MM-DD day string into the requested granularity bucket. */
function bucketDay(day: string, g: Granularity): string {
  if (g === "all") return "all"; // entire period = single bucket
  if (g === "day") return day;
  if (g === "month") return `${day.slice(0, 7)}-01`;
  // week: Monday of the local-time week containing `day`.
  const d = new Date(`${day}T00:00:00`);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function groupKeyValue(r: DailyAggRow, groupBy: GroupBy): string {
  switch (groupBy) {
    case "provider":
      return r.provider_id;
    case "model":
      return r.model_id;
    case "family":
      return familyKey(r.provider_id, r.model_id);
    case "manufacturer":
      return detectManufacturer(r.model_id);
    case "total":
    default:
      return "total";
  }
}

function validGranularity(v: string | undefined): Granularity {
  return v === "week" || v === "month" || v === "day" || v === "all" ? v : "day";
}

function validGroupBy(v: string | undefined): GroupBy {
  return v === "provider" ||
    v === "family" ||
    v === "manufacturer" ||
    v === "model" ||
    v === "total"
    ? v
    : "total";
}

app.get("/api/stats/timeseries", (c) =>
  handleApi(c, (db) => {
    const granularity = validGranularity(c.req.query("granularity"));
    const groupBy = validGroupBy(c.req.query("groupBy"));
    const { sql, params } = projectFilter(c.req.query("project"));
    const r = readRange(c);
    if (!r.ok) return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    const hasRange = r.from != null && r.to != null;
    const rangeSql = hasRange ? " AND day BETWEEN ? AND ?" : "";
    const rangeParams = hasRange ? [r.from!, r.to!] : [];
    const rows = db
      .prepare(
        `SELECT day, provider_id, model_id, msg_count, input_tokens,
                output_tokens, reasoning_tokens, cache_read, cache_write, cost
          FROM daily_agg
          WHERE 1=1${sql}${rangeSql}`,
      )
      .all(...params, ...rangeParams) as DailyAggRow[];

    const acc = new Map<string, TimeseriesPoint>();
    for (const r of rows) {
      const period = bucketDay(r.day, granularity);
      const key = groupKeyValue(r, groupBy);
      const id = period + "\u0000" + key;
      const existing = acc.get(id);
      if (existing) {
        existing.msgCount += r.msg_count;
        existing.inputTokens += r.input_tokens;
        existing.outputTokens += r.output_tokens;
        existing.reasoningTokens += r.reasoning_tokens;
        existing.cacheReadTokens += r.cache_read;
        existing.cacheWriteTokens += r.cache_write;
        existing.cost += r.cost;
      } else {
        acc.set(id, {
          day: period,
          key,
          msgCount: r.msg_count,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          reasoningTokens: r.reasoning_tokens,
          cacheReadTokens: r.cache_read,
          cacheWriteTokens: r.cache_write,
          cost: r.cost,
        });
      }
    }

    const points = Array.from(acc.values()).sort((a, b) =>
      a.day === b.day ? a.key.localeCompare(b.key) : a.day.localeCompare(b.day),
    );
    const response: TimeseriesResponse = { points };
    return c.json(response);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/stats/models  (aggregated per provider_id + model_id)
// ---------------------------------------------------------------------------
interface ModelAggRow {
  provider_id: string;
  model_id: string;
  msgCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

app.get("/api/stats/models", (c) =>
  handleApi(c, (db) => {
    const { sql, params } = projectFilter(c.req.query("project"));
    const r = readRange(c);
    if (!r.ok) return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    const hasRange = r.from != null && r.to != null;
    const rangeSql = hasRange ? " AND day BETWEEN ? AND ?" : "";
    const rangeParams = hasRange ? [r.from!, r.to!] : [];
    const rows = db
      .prepare(
        `SELECT provider_id, model_id,
                SUM(msg_count) AS msgCount,
                SUM(input_tokens) AS inputTokens,
                SUM(output_tokens) AS outputTokens,
                SUM(reasoning_tokens) AS reasoningTokens,
                SUM(cache_read) AS cacheReadTokens,
                SUM(cache_write) AS cacheWriteTokens,
                SUM(cost) AS cost
          FROM daily_agg
          WHERE 1=1${sql}${rangeSql}
          GROUP BY provider_id, model_id`,
      )
      .all(...params, ...rangeParams) as ModelAggRow[];

    const result: ModelBreakdownRow[] = rows.map((r) => {
      const meta = resolveModelMeta(r.provider_id, r.model_id);
      return {
        providerId: r.provider_id,
        providerName: meta.providerName,
        modelId: r.model_id,
        modelName: meta.modelName,
        family: meta.family,
        contextWindow: meta.contextWindow,
        msgCount: r.msgCount,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        reasoningTokens: r.reasoningTokens,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
        cost: r.cost,
        cacheHitRatio: cacheHitRatio(
          r.inputTokens,
          r.cacheReadTokens,
          r.cacheWriteTokens,
        ),
      };
    });

    result.sort((a, b) => b.cost - a.cost);
    return c.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/stats/projects — projects = directories (per user decision):
// aggregated from sessions_agg GROUP BY directory, ordered by cost desc.
// ---------------------------------------------------------------------------
app.get("/api/stats/projects", (c) =>
  handleApi(c, (db) => {
    const { sql, params } = projectFilter(c.req.query("project"));
    const r = readRange(c);
    if (!r.ok) return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    const hasRange = r.from != null && r.to != null;
    const rangeSql = hasRange
      ? " AND date(time_updated / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?"
      : "";
    const rangeParams = hasRange ? [r.from!, r.to!] : [];
    const rows = db
      .prepare(
        `SELECT directory,
                COUNT(*) AS session_count,
                SUM(msg_count) AS msg_count,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(reasoning_tokens) AS reasoning_tokens,
                SUM(cache_read) AS cache_read,
                SUM(cache_write) AS cache_write,
                SUM(cost) AS cost,
                MAX(time_updated) AS last_activity_at
          FROM sessions_agg
          WHERE 1=1${sql}${rangeSql}
          GROUP BY directory
          ORDER BY cost DESC`,
      )
      .all(...params, ...rangeParams) as Array<{
      directory: string;
      session_count: number;
      msg_count: number;
      input_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
      cache_read: number;
      cache_write: number;
      cost: number;
      last_activity_at: number;
    }>;

    const result: ProjectRow[] = rows.map((r) => ({
      projectId: r.directory, // the directory IS the project
      directory: r.directory,
      name: null,
      sessionCount: r.session_count,
      msgCount: r.msg_count,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      reasoningTokens: r.reasoning_tokens,
      cacheReadTokens: r.cache_read,
      cacheWriteTokens: r.cache_write,
      cost: r.cost,
      lastActivityAt: r.last_activity_at,
    }));
    return c.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/stats/sessions?limit=&offset=&sort=&dir=(asc|desc)
// ---------------------------------------------------------------------------
interface SessionAggRow {
  session_id: string;
  project_id: string;
  directory: string;
  title: string | null;
  model: string | null;
  agent: string | null;
  msg_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  time_created: number;
  time_updated: number;
}

function clampInt(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Fixed map from client sort key to a safe SQL ORDER BY expression. Never built
 * from user input via interpolation — so a bad `sort` value can only fall back
 * to the `recent` default, never produce SQL injection.
 */
const SESSION_SORT_COLUMNS: Record<string, string> = {
  recent: "time_updated",
  created: "time_created",
  cost: "cost",
  tokens: "(input_tokens + output_tokens + reasoning_tokens)",
  msgCount: "msg_count",
  cacheHitRatio:
    "(cache_read / NULLIF(input_tokens + cache_read + cache_write, 0))",
  title: "LOWER(COALESCE(title, ''))",
  directory: "LOWER(directory)",
};

app.get("/api/stats/sessions", (c) =>
  handleApi(c, (db) => {
    const limit = clampInt(c.req.query("limit"), 50, 1, 500);
    const offset = clampInt(c.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

    const { sql, params } = projectFilter(c.req.query("project"));
    const r = readRange(c);
    if (!r.ok) return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    const hasRange = r.from != null && r.to != null;
    const rangeSql = hasRange
      ? " AND date(time_updated / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?"
      : "";
    const rangeParams = hasRange ? [r.from!, r.to!] : [];
    const sortRaw = c.req.query("sort");
    const orderCol =
      SESSION_SORT_COLUMNS[sortRaw ?? "recent"] ?? SESSION_SORT_COLUMNS.recent;
    const dirSql = c.req.query("dir") === "asc" ? "ASC" : "DESC";

    const rows = db
      .prepare(
        `SELECT session_id, project_id, directory, title, model, agent,
                msg_count, input_tokens, output_tokens, reasoning_tokens,
                cache_read, cache_write, cost, time_created, time_updated
          FROM sessions_agg
          WHERE 1=1${sql}${rangeSql}
          ORDER BY ${orderCol} ${dirSql}
          LIMIT ? OFFSET ?`,
      )
      .all(...params, ...rangeParams, limit, offset) as SessionAggRow[];

    const result: SessionRow[] = rows.map((r) => ({
      sessionId: r.session_id,
      projectId: r.project_id,
      directory: r.directory,
      title: r.title,
      modelId: r.model,
      agent: r.agent,
      msgCount: r.msg_count,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      reasoningTokens: r.reasoning_tokens,
      cacheReadTokens: r.cache_read,
      cacheWriteTokens: r.cache_write,
      cost: r.cost,
      cacheHitRatio: cacheHitRatio(r.input_tokens, r.cache_read, r.cache_write),
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
    }));
    return c.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/stats/cache-analysis
// ---------------------------------------------------------------------------
interface SessionMsgRow {
  session_id: string;
  title: string | null;
  msg_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
}

/** Pearson correlation + ordinary least-squares linear fit for (x, y). */
function pearsonAndFit(xs: number[], ys: number[]): {
  pearsonCorrelation: number | null;
  linearFit: { slope: number; intercept: number } | null;
} {
  const n = xs.length;
  if (n < 2) return { pearsonCorrelation: null, linearFit: null };
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    sx += x;
    sy += y;
    sxy += x * y;
    sxx += x * x;
    syy += y * y;
  }
  const num = n * sxy - sx * sy;
  const denX = n * sxx - sx * sx;
  const denY = n * syy - sy * sy;
  const den = Math.sqrt(denX * denY);
  const pearson = den > 0 ? num / den : null;
  const slope = denX > 0 ? num / denX : null;
  const intercept = slope !== null ? (sy - slope * sx) / n : null;
  return {
    pearsonCorrelation: pearson,
    linearFit: slope !== null && intercept !== null ? { slope, intercept } : null,
  };
}

const BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: "1-5", min: 1, max: 5 },
  { label: "6-10", min: 6, max: 10 },
  { label: "11-25", min: 11, max: 25 },
  { label: "26-50", min: 26, max: 50 },
  { label: "51-100", min: 51, max: 100 },
  { label: "101+", min: 101, max: Number.MAX_SAFE_INTEGER },
];

app.get("/api/stats/cache-analysis", (c) =>
  handleApi(c, (db) => {
    // Sessions with very few messages have an unstable cache-hit ratio (the
    // context is still being built up). Default 20, configurable via query.
    // Applies to points/correlation/regression; the buckets stay complete on
    // purpose (they show the stabilization across session sizes).
    const minMessages = Math.max(
      1,
      Number.parseInt(c.req.query("minMessages") ?? "20", 10) || 20,
    );
    const { sql: pSql, params: pParams } = projectFilter(c.req.query("project"));
    const r = readRange(c);
    if (!r.ok) return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    const hasRange = r.from != null && r.to != null;
    const rangeSql = hasRange
      ? " AND date(time_updated / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?"
      : "";
    const rangeParams = hasRange ? [r.from!, r.to!] : [];
    const rows = db
      .prepare(
        `SELECT session_id, title, msg_count, input_tokens, output_tokens,
                reasoning_tokens, cache_read, cache_write, cost
          FROM sessions_agg
          WHERE msg_count >= ?${pSql}${rangeSql}`,
      )
      .all(minMessages, ...pParams, ...rangeParams) as SessionMsgRow[];

    const points: CacheAnalysisPoint[] = rows.map((r) => ({
      sessionId: r.session_id,
      title: r.title,
      msgCount: r.msg_count,
      cacheHitRatio: cacheHitRatio(r.input_tokens, r.cache_read, r.cache_write),
      totalTokens:
        r.input_tokens + r.output_tokens + r.reasoning_tokens + r.cache_read,
      cost: r.cost,
    }));

    const xs = points.map((p) => p.msgCount);
    const ys = points.map((p) => p.cacheHitRatio);
    const fit = pearsonAndFit(xs, ys);

    const bucketAverages = BUCKETS.map((b) => {
      const inBucket = points.filter(
        (p) => p.msgCount >= b.min && p.msgCount <= b.max,
      );
      const avg =
        inBucket.length > 0
          ? inBucket.reduce((s, p) => s + p.cacheHitRatio, 0) / inBucket.length
          : 0;
      return { bucket: b.label, count: inBucket.length, avgCacheHitRatio: avg };
    });

    const response: CacheAnalysis = {
      points,
      pearsonCorrelation: fit.pearsonCorrelation,
      linearFit: fit.linearFit,
      bucketAverages,
    };
    return c.json(response);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/stats/heatmap  (hourly_agg)
// ---------------------------------------------------------------------------
interface HourlyAggRow {
  day: string;
  hour: number;
  msg_count: number;
  cost: number;
}

app.get("/api/stats/heatmap", (c) =>
  handleApi(c, (db) => {
    const { sql, params } = projectFilter(c.req.query("project"));
    const r = readRange(c);
    if (!r.ok) return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    const hasRange = r.from != null && r.to != null;
    const rangeSql = hasRange ? " AND day BETWEEN ? AND ?" : "";
    const rangeParams = hasRange ? [r.from!, r.to!] : [];
    const rows = db
      .prepare(
        `SELECT day, hour, msg_count, cost FROM hourly_agg
          WHERE 1=1${sql}${rangeSql}`,
      )
      .all(...params, ...rangeParams) as HourlyAggRow[];
    const result: HeatmapCell[] = rows.map((r) => ({
      day: r.day,
      hour: r.hour,
      msgCount: r.msg_count,
      cost: r.cost,
    }));
    return c.json(result);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/stats/directories — directories for the global filter bar
// ---------------------------------------------------------------------------
app.get("/api/stats/directories", (c) =>
  handleApi(c, (db) => {
    const rows = db
      .prepare(
        `SELECT directory,
                SUM(msg_count) AS msg_count,
                SUM(cost) AS cost
          FROM sessions_agg
          GROUP BY directory
          ORDER BY msg_count DESC`,
      )
      .all() as Array<{ directory: string; msg_count: number; cost: number }>;
    return c.json(
      rows.map((r) => ({
        directory: r.directory,
        basename: basenameOf(r.directory),
        msgCount: r.msg_count,
        cost: r.cost,
      })),
    );
  }),
);

function basenameOf(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// ---------------------------------------------------------------------------
// GET /api/stats/day/:date?project= — day detail (DayDetail contract)
// ---------------------------------------------------------------------------
interface DayAggRow {
  day: string;
  directory: string;
  provider_id: string;
  model_id: string;
  msg_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
}

app.get("/api/stats/day/:date", (c) =>
  handleApi(c, (db) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "invalid date, expected YYYY-MM-DD" }, 400);
    }
    const { sql, params } = projectFilter(c.req.query("project"));

    const dayRows = db
      .prepare(
        `SELECT day, directory, provider_id, model_id, msg_count,
                input_tokens, output_tokens, reasoning_tokens,
                cache_read, cache_write, cost
          FROM daily_agg
          WHERE day = ?${sql}`,
      )
      .all(date, ...params) as DayAggRow[];

    let msgCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let cost = 0;
    const byModelMap = new Map<
      string,
      { providerId: string; modelId: string; msgCount: number; totalTokens: number; cost: number }
    >();
    const byProjectMap = new Map<
      string,
      { directory: string; msgCount: number; totalTokens: number; cost: number }
    >();
    for (const r of dayRows) {
      msgCount += r.msg_count;
      inputTokens += r.input_tokens;
      outputTokens += r.output_tokens;
      reasoningTokens += r.reasoning_tokens;
      cacheReadTokens += r.cache_read;
      cacheWriteTokens += r.cache_write;
      cost += r.cost;

      const mk = `${r.provider_id}\u0000${r.model_id}`;
      const mEntry = byModelMap.get(mk) ?? {
        providerId: r.provider_id,
        modelId: r.model_id,
        msgCount: 0,
        totalTokens: 0,
        cost: 0,
      };
      mEntry.msgCount += r.msg_count;
      // Menschliche Entscheidung (2026-08-21): Token-Totale inkl. Cache Read.
      mEntry.totalTokens +=
        r.input_tokens + r.output_tokens + r.reasoning_tokens + r.cache_read;
      mEntry.cost += r.cost;
      byModelMap.set(mk, mEntry);

      const pEntry = byProjectMap.get(r.directory) ?? {
        directory: r.directory,
        msgCount: 0,
        totalTokens: 0,
        cost: 0,
      };
      pEntry.msgCount += r.msg_count;
      // Menschliche Entscheidung (2026-08-21): Token-Totale inkl. Cache Read.
      pEntry.totalTokens +=
        r.input_tokens + r.output_tokens + r.reasoning_tokens + r.cache_read;
      pEntry.cost += r.cost;
      byProjectMap.set(r.directory, pEntry);
    }

    const hourRows = db
      .prepare(
        `SELECT hour, SUM(msg_count) AS msg_count
          FROM hourly_agg
          WHERE day = ?${sql}
          GROUP BY hour`,
      )
      .all(date, ...params) as Array<{ hour: number; msg_count: number }>;
    const byHour = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      msgCount: num(hourRows.find((x) => x.hour === h)?.msg_count),
    }));

    const sessionRows = db
      .prepare(
        `SELECT session_id, project_id, directory, title, model, agent,
                msg_count, input_tokens, output_tokens, reasoning_tokens,
                cache_read, cache_write, cost, time_created, time_updated
          FROM sessions_agg
          WHERE date(time_updated / 1000, 'unixepoch', 'localtime') = ?${sql}
          ORDER BY time_updated DESC`,
      )
      .all(date, ...params) as SessionAggRow[];

    const sessions: SessionRow[] = sessionRows.map((r) => ({
      sessionId: r.session_id,
      projectId: r.project_id,
      directory: r.directory,
      title: r.title,
      modelId: r.model,
      agent: r.agent,
      msgCount: r.msg_count,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      reasoningTokens: r.reasoning_tokens,
      cacheReadTokens: r.cache_read,
      cacheWriteTokens: r.cache_write,
      cost: r.cost,
      cacheHitRatio: cacheHitRatio(r.input_tokens, r.cache_read, r.cache_write),
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
    }));

    const detail: DayDetail = {
      date,
      msgCount,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cost,
      sessionCount: sessions.length,
      byHour,
      byModel: [...byModelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      byProject: [...byProjectMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      sessions,
    };
    return c.json(detail);
  }),
);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /api/stats/range?from=&to=&project= — period detail (RangeDetail)
// Generalizes the single-day detail to an arbitrary YYYY-MM-DD range so the
// dashboard can drill into a week or month. from/to are REQUIRED and validated;
// invalid/wrong format -> 400. Returns totals, by-model / by-project aggregates,
// a time breakdown (byHour for single-day ranges, byDay otherwise) and the
// sessions active in the range.
// ---------------------------------------------------------------------------
interface RangeAggRow {
  provider_id: string;
  model_id: string;
  directory: string;
  msg_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
}

app.get("/api/stats/range", (c) =>
  handleApi(c, (db) => {
    const r = readRange(c);
    if (!r.ok) {
      return c.json({ error: "invalid from/to, expected YYYY-MM-DD" }, 400);
    }
    if (!r.from || !r.to) {
      return c.json({ error: "from and to are required" }, 400);
    }
    const { sql, params } = projectFilter(c.req.query("project"));

    const rows = db
      .prepare(
        `SELECT provider_id, model_id, directory,
                SUM(msg_count) AS msg_count,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(reasoning_tokens) AS reasoning_tokens,
                SUM(cache_read) AS cache_read,
                SUM(cache_write) AS cache_write,
                SUM(cost) AS cost
          FROM daily_agg
          WHERE day BETWEEN ? AND ?${sql}
          GROUP BY provider_id, model_id, directory`,
      )
      .all(r.from, r.to, ...params) as RangeAggRow[];

    let msgCount = 0,
      inputTokens = 0,
      outputTokens = 0,
      reasoningTokens = 0,
      cacheReadTokens = 0,
      cacheWriteTokens = 0,
      cost = 0;
    const byModelMap = new Map<
      string,
      { providerId: string; modelId: string; msgCount: number; totalTokens: number; cost: number }
    >();
    const byProjectMap = new Map<
      string,
      { directory: string; msgCount: number; totalTokens: number; cost: number }
    >();
    for (const rr of rows) {
      msgCount += rr.msg_count;
      inputTokens += rr.input_tokens;
      outputTokens += rr.output_tokens;
      reasoningTokens += rr.reasoning_tokens;
      cacheReadTokens += rr.cache_read;
      cacheWriteTokens += rr.cache_write;
      cost += rr.cost;

      const mk = `${rr.provider_id}\u0000${rr.model_id}`;
      const m = byModelMap.get(mk) ?? {
        providerId: rr.provider_id,
        modelId: rr.model_id,
        msgCount: 0,
        totalTokens: 0,
        cost: 0,
      };
      m.msgCount += rr.msg_count;
      m.totalTokens += rr.input_tokens + rr.output_tokens + rr.reasoning_tokens;
      m.cost += rr.cost;
      byModelMap.set(mk, m);

      const pr = byProjectMap.get(rr.directory) ?? {
        directory: rr.directory,
        msgCount: 0,
        totalTokens: 0,
        cost: 0,
      };
      pr.msgCount += rr.msg_count;
      pr.totalTokens += rr.input_tokens + rr.output_tokens + rr.reasoning_tokens;
      pr.cost += rr.cost;
      byProjectMap.set(rr.directory, pr);
    }

    let byHour: Array<{ hour: number; msgCount: number }> = [];
    let byDay: Array<{ day: string; msgCount: number }> = [];
    if (r.from === r.to) {
      const hr = db
        .prepare(
          `SELECT hour, SUM(msg_count) AS msg_count FROM hourly_agg WHERE day = ?${sql} GROUP BY hour`,
        )
        .all(r.from, ...params) as Array<{ hour: number; msg_count: number }>;
      byHour = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        msgCount: num(hr.find((x) => x.hour === h)?.msg_count),
      }));
    } else {
      const dy = db
        .prepare(
          `SELECT day, SUM(msg_count) AS msg_count FROM daily_agg WHERE day BETWEEN ? AND ?${sql} GROUP BY day ORDER BY day`,
        )
        .all(r.from, r.to, ...params) as Array<{ day: string; msg_count: number }>;
      byDay = dy.map((x) => ({ day: x.day, msgCount: num(x.msg_count) }));
    }

    const sessionRows = db
      .prepare(
        `SELECT session_id, project_id, directory, title, model, agent,
                msg_count, input_tokens, output_tokens, reasoning_tokens,
                cache_read, cache_write, cost, time_created, time_updated
          FROM sessions_agg
          WHERE date(time_updated / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?${sql}
          ORDER BY time_updated DESC`,
      )
      .all(r.from, r.to, ...params) as SessionAggRow[];

    const sessions: SessionRow[] = sessionRows.map((s) => ({
      sessionId: s.session_id,
      projectId: s.project_id,
      directory: s.directory,
      title: s.title,
      modelId: s.model,
      agent: s.agent,
      msgCount: s.msg_count,
      inputTokens: s.input_tokens,
      outputTokens: s.output_tokens,
      reasoningTokens: s.reasoning_tokens,
      cacheReadTokens: s.cache_read,
      cacheWriteTokens: s.cache_write,
      cost: s.cost,
      cacheHitRatio: cacheHitRatio(s.input_tokens, s.cache_read, s.cache_write),
      timeCreated: s.time_created,
      timeUpdated: s.time_updated,
    }));

    return c.json({
      from: r.from,
      to: r.to,
      msgCount,
      inputTokens,
      outputTokens,
      reasoningTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cost,
      sessionCount: sessions.length,
      byHour,
      byDay,
      byModel: [...byModelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      byProject: [...byProjectMap.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      sessions,
    });
  }),
);

// GET /api/stats/share (+ .svg / .png) — Share-Card (Todo 28/28e)
// Query: range=today|week|month, project=<basename>,
//        projects=all|hide|none (default all; replaces hideProjects=1),
//        lang=de|en. Invalid range or projects -> 400.
// ---------------------------------------------------------------------------
type ShareParams = {
  range: ShareRange;
  project?: string;
  projects: ShareProjectsMode;
  lang: ShareLang;
};

function shareParams(c: Context): ShareParams | { error: string } {
  const raw = c.req.query("range") ?? "today";
  const validRanges = [
    "today",
    "yesterday",
    "week",
    "lastweek",
    "month",
    "lastmonth",
  ] as const;
  if (!(validRanges as readonly string[]).includes(raw)) {
    return {
      error: "invalid range, expected today|yesterday|week|lastweek|month|lastmonth",
    };
  }
  const rawProjects = c.req.query("projects") ?? "all";
  if (rawProjects !== "all" && rawProjects !== "hide" && rawProjects !== "none") {
    return { error: "invalid projects, expected all|hide|none" };
  }
  const langRaw = c.req.query("lang");
  return {
    range: raw as ShareRange,
    project: c.req.query("project") || undefined,
    projects: rawProjects,
    lang: langRaw === "en" ? "en" : "de",
  };
}

app.get("/api/stats/share", (c) =>
  handleApi(c, (db) => {
    const p = shareParams(c);
    if ("error" in p) return c.json({ error: p.error }, 400);
    return c.json(getShareData(db, p));
  }),
);

app.get("/api/stats/share.svg", (c) =>
  handleApi(c, (db) => {
    const p = shareParams(c);
    if ("error" in p) return c.json({ error: p.error }, 400);
    const svg = renderShareCard(getShareData(db, p));
    return new Response(svg, {
      headers: { "content-type": "image/svg+xml; charset=utf-8" },
    });
  }),
);

app.get("/api/stats/share.png", async (c) => {
  const db = openDatabase();
  if (!db) {
    return c.json(
      { error: `stats.db is not available: ${getDbError() ?? "unknown error"}` },
      503,
    );
  }
  const p = shareParams(c);
  if ("error" in p) return c.json({ error: p.error }, 400);
  const svg = renderShareCard(getShareData(db, p));
  const png = await renderSharePng(svg);
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png" },
  });
});

// ---------------------------------------------------------------------------
// GET /api/stats/meta
// ---------------------------------------------------------------------------
interface MetaRow {
  value: string;
}

app.get("/api/stats/meta", (c) =>
  handleApi(c, (db) => {
    const lastSyncRow = db
      .prepare(`SELECT value FROM meta WHERE key = 'last_sync'`)
      .get() as MetaRow | undefined;
    const sourceRow = db
      .prepare(`SELECT value FROM meta WHERE key = 'source_db'`)
      .get() as MetaRow | undefined;
    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM messages`)
      .get() as { c: number } | undefined;

    const lastSync = lastSyncRow ? Number(lastSyncRow.value) : null;
    const response: MetaInfo = {
      lastSync: Number.isFinite(lastSync) ? lastSync : null,
      sourceDb: sourceRow?.value ?? "",
      messageCount: countRow?.c ?? 0,
    };
    return c.json(response);
  }),
);

// ---------------------------------------------------------------------------
// Static frontend (production build) + SPA fallback — bewusst NUR außerhalb
// von NODE_ENV=development: in der Dev-Umgebung (dev:all) liefert :3712 nur
// die API, das Frontend kommt live von Vite (:5173). So zeigt :3712 nie ein
// veraltetes dist/-Build statt des aktuellen Codes.
// ---------------------------------------------------------------------------
if (fs.existsSync(DIST_DIR) && process.env.NODE_ENV !== "development") {
  const staticMW = serveStatic({ root: DIST_DIR });
  app.use("*", (c, next) => {
    if (c.req.path.startsWith("/api")) return next();
    return staticMW(c, next);
  });
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json({ error: "Not found" }, 404);
    }
    const html = fs.readFileSync(path.join(DIST_DIR, "index.html"), "utf8");
    return c.html(html);
  });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
const db = openDatabase();
if (!db) {
  console.warn(
    `[opencode-usage] WARNING: stats.db not found at ${resolveDbPath()}. ` +
      `API endpoints will respond with HTTP 503 until it is available.`,
  );
} else {
  console.log(`[opencode-usage] stats.db loaded from ${resolveDbPath()}`);
}

serve(
  { fetch: (req) => app.fetch(req), port: PORT },
  (info) => {
    console.log(
      `[opencode-usage] API listening on http://localhost:${info.port}`,
    );
  },
);
