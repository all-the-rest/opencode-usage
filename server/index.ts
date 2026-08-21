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

app.get("/api/stats/summary", (c) =>
  handleApi(c, (db) => {
    const row = db
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
         FROM messages`,
      )
      .get() as SummaryRow | undefined;

    const input = num(row?.inputTokens);
    const output = num(row?.outputTokens);
    const reasoning = num(row?.reasoningTokens);
    const cacheRead = num(row?.cacheReadTokens);
    const cacheWrite = num(row?.cacheWriteTokens);

    const summary: Summary = {
      totalTokens: input + output + reasoning,
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
// GET /api/stats/timeseries?granularity=day|week|month&groupBy=provider|family|model|total
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
  if (g === "day") return day;
  if (g === "month") return `${day.slice(0, 7)}-01`;
  // week: Monday of the ISO-ish week (local time, matching the stored day).
  const d = new Date(`${day}T00:00:00`);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function groupKeyValue(
  r: DailyAggRow,
  groupBy: GroupBy,
): string {
  switch (groupBy) {
    case "provider":
      return r.provider_id;
    case "model":
      return r.model_id;
    case "family":
      return familyKey(r.provider_id, r.model_id);
    case "total":
    default:
      return "total";
  }
}

function validGranularity(v: string | undefined): Granularity {
  return v === "week" || v === "month" || v === "day" ? v : "day";
}

function validGroupBy(v: string | undefined): GroupBy {
  return v === "provider" || v === "family" || v === "model" || v === "total"
    ? v
    : "total";
}

app.get("/api/stats/timeseries", (c) =>
  handleApi(c, (db) => {
    const granularity = validGranularity(c.req.query("granularity"));
    const groupBy = validGroupBy(c.req.query("groupBy"));
    const rows = db
      .prepare(
        `SELECT day, provider_id, model_id, msg_count, input_tokens,
                output_tokens, reasoning_tokens, cache_read, cache_write, cost
         FROM daily_agg`,
      )
      .all() as DailyAggRow[];

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
         GROUP BY provider_id, model_id`,
      )
      .all() as ModelAggRow[];

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
// GET /api/stats/projects  (project_agg, sorted by cost desc)
// ---------------------------------------------------------------------------
interface ProjectAggRow {
  project_id: string;
  directory: string;
  name: string | null;
  session_count: number;
  msg_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  last_activity_at: number;
}

app.get("/api/stats/projects", (c) =>
  handleApi(c, (db) => {
    const rows = db
      .prepare(
        `SELECT project_id, directory, name, session_count, msg_count,
                input_tokens, output_tokens, reasoning_tokens,
                cache_read, cache_write, cost, last_activity_at
         FROM project_agg
         ORDER BY cost DESC`,
      )
      .all() as ProjectAggRow[];

    const result: ProjectRow[] = rows.map((r) => ({
      projectId: r.project_id,
      directory: r.directory,
      name: r.name,
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
// GET /api/stats/sessions?limit=&offset=&sort=(cost|tokens|recent)&dir=(asc|desc)
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

app.get("/api/stats/sessions", (c) =>
  handleApi(c, (db) => {
    const limit = clampInt(c.req.query("limit"), 50, 1, 500);
    const offset = clampInt(c.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

    const sortRaw = c.req.query("sort");
    const orderCol =
      sortRaw === "tokens"
        ? "(input_tokens + output_tokens + reasoning_tokens)"
        : sortRaw === "recent"
          ? "time_updated"
          : "cost";
    const dirSql = c.req.query("dir") === "asc" ? "ASC" : "DESC";

    const rows = db
      .prepare(
        `SELECT session_id, project_id, directory, title, model, agent,
                msg_count, input_tokens, output_tokens, reasoning_tokens,
                cache_read, cache_write, cost, time_created, time_updated
         FROM sessions_agg
         ORDER BY ${orderCol} ${dirSql}
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as SessionAggRow[];

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

interface FitResult {
  pearsonCorrelation: number | null;
  linearFit: { slope: number; intercept: number } | null;
}

/** Pearson correlation + ordinary least-squares linear fit for (x, y). */
function pearsonAndFit(xs: number[], ys: number[]): FitResult {
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
    // minMessages: Sessions mit sehr wenigen Nachrichten haben eine instabile
    // Cache-Hit-Ratio (Kontext wird erst aufgebaut). Default 20, via Query
    // parametrierbar. Gilt für points/Korrelation/Regression; die Buckets
    // bleiben bewusst komplett (sie zeigen die Stabilisierung über die Zeit).
    const minMessages = Math.max(
      1,
      Number.parseInt(c.req.query("minMessages") ?? "20", 10) || 20,
    );
    const rows = db
      .prepare(
        `SELECT session_id, title, msg_count, input_tokens, output_tokens,
                reasoning_tokens, cache_read, cache_write, cost
         FROM sessions_agg
         WHERE msg_count >= ?`,
      )
      .all(minMessages) as SessionMsgRow[];

    const points: CacheAnalysisPoint[] = rows.map((r) => ({
      sessionId: r.session_id,
      title: r.title,
      msgCount: r.msg_count,
      cacheHitRatio: cacheHitRatio(r.input_tokens, r.cache_read, r.cache_write),
      totalTokens: r.input_tokens + r.output_tokens + r.reasoning_tokens,
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
    const rows = db
      .prepare(`SELECT day, hour, msg_count, cost FROM hourly_agg`)
      .all() as HourlyAggRow[];
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
// GET /api/meta
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
// Static frontend (production build) + SPA fallback
// ---------------------------------------------------------------------------
if (fs.existsSync(DIST_DIR)) {
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
