/**
 * Extractor: builds/updates the analysis DB (data/stats.db) from the OpenCode
 * source DB (~/.local/share/opencode/opencode.db) exactly per
 * docs/stats-db-schema.md.
 *
 * The source DB is opened STRICT read-only. better-sqlite3@13 does NOT enable
 * URI mode for the `file:` prefix, so the literal `file:...?mode=ro` form fails
 * ("unable to open database file") on this WAL database — the strict-read-only
 * equivalent is the `{ readonly: true }` option, which is what we use.
 *
 * Incremental sync: only messages with time_created >= last_sync are processed
 * (idempotent via INSERT OR REPLACE on message_id); the affected aggregate keys
 * (sessions_agg / daily_agg / hourly_agg / project_agg) are recomputed via
 * DELETE + INSERT from the messages table.
 */

import Database from 'better-sqlite3';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(scriptDir, '..');

export const SOURCE_DB = path.join(os.homedir(), '.local/share/opencode/opencode.db');
export const ANALYSIS_DB = path.join(PROJECT_ROOT, 'data', 'stats.db');

// ---------------------------------------------------------------------------
// local-time helpers — the analysis DB stores day as local YYYY-MM-DD and hour
// as local 0-23 (see docs/stats-db-schema.md).
// ---------------------------------------------------------------------------
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function localHour(ms: number): number {
  return new Date(ms).getHours();
}
function dayRange(day: string): { start: number; end: number } {
  const start = new Date(day + 'T00:00:00').getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------
function initAnalysisDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      tokens_input INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS messages_time_idx ON messages(time_created);
    CREATE INDEX IF NOT EXISTS messages_provider_model_idx ON messages(provider_id, model_id);

    CREATE TABLE IF NOT EXISTS sessions_agg (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT,
      model TEXT,
      agent TEXT,
      msg_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_agg (
      day TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (day, provider_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS hourly_agg (
      day TEXT NOT NULL,
      hour INTEGER NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (day, hour)
    );

    CREATE TABLE IF NOT EXISTS project_agg (
      project_id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      name TEXT,
      session_count INTEGER NOT NULL DEFAULT 0,
      msg_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      last_activity_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// row types
// ---------------------------------------------------------------------------
interface SourceMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}
interface SessionMeta {
  id: string;
  project_id: string;
  directory: string;
  title: string | null;
  model: string | null;
  agent: string | null;
  time_created: number;
  time_updated: number;
}
interface ProjectMeta {
  id: string;
  name: string | null;
  worktree: string | null;
}
interface SumRow {
  msg_count: number;
  session_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost: number | null;
  max_time: number | null;
}

export interface SyncResult {
  newMessages: number;
  durationMs: number;
  full: boolean;
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------
export function sync(opts: { full?: boolean } = {}): SyncResult {
  const startedAt = Date.now();
  const full = opts.full === true;

  fs.mkdirSync(path.dirname(ANALYSIS_DB), { recursive: true });
  const analysis = new Database(ANALYSIS_DB);
  try {
    analysis.pragma('journal_mode = WAL');
    initAnalysisDb(analysis);

    let lastSync: number;
    if (full) {
      analysis.exec(
        'DELETE FROM messages; DELETE FROM sessions_agg; DELETE FROM daily_agg; DELETE FROM hourly_agg; DELETE FROM project_agg;',
      );
      lastSync = 0;
    } else {
      const row = analysis
        .prepare('SELECT value FROM meta WHERE key = ?')
        .get('last_sync') as { value: string } | undefined;
      lastSync = row ? Number(row.value) : 0;
      if (!Number.isFinite(lastSync)) lastSync = 0;
    }

    // --- read source (STRICT read-only) ---
    const source = new Database(SOURCE_DB, { fileMustExist: true, readonly: true });
    try {
      const selectMsgs = source.prepare(`
        SELECT id, session_id, time_created, data
        FROM message
        WHERE time_created >= ?
          AND json_extract(data, '$.role') = 'assistant'
          AND json_extract(data, '$.tokens') IS NOT NULL
        ORDER BY time_created ASC
      `);
      const rawMsgs = selectMsgs.all(lastSync) as SourceMessageRow[];

      const items: Array<Record<string, unknown>> = [];
      const affectedSessions = new Set<string>();
      const affectedDays = new Set<string>();
      let maxTime = lastSync;

      for (const r of rawMsgs) {
        let data: any;
        try {
          data = JSON.parse(r.data);
        } catch {
          continue;
        }
        if (data.role !== 'assistant' || !data.tokens) continue;
        const t = data.tokens;
        const cache = t.cache ?? {};
        items.push({
          message_id: r.id,
          session_id: r.session_id,
          time_created: r.time_created,
          provider_id: data.providerID ?? '',
          model_id: data.modelID ?? '',
          cost: typeof data.cost === 'number' ? data.cost : 0,
          tokens_input: t.input ?? 0,
          tokens_output: t.output ?? 0,
          tokens_reasoning: t.reasoning ?? 0,
          cache_read: cache.read ?? 0,
          cache_write: cache.write ?? 0,
        });
        affectedSessions.add(r.session_id);
        affectedDays.add(localDay(r.time_created));
        if (r.time_created > maxTime) maxTime = r.time_created;
      }

      // session metadata for affected sessions (also reveals orphans)
      const sessionMeta = new Map<string, SessionMeta>();
      const sessionIds = [...affectedSessions];
      for (const ids of chunk(sessionIds, 500)) {
        const placeholders = ids.map(() => '?').join(',');
        const rows = source
          .prepare(
            `SELECT id, project_id, directory, title, model, agent, time_created, time_updated
             FROM session_v2 WHERE id IN (${placeholders})`,
          )
          .all(...ids) as SessionMeta[];
        for (const row of rows) sessionMeta.set(row.id, row);
      }

      // affected projects + all their sessions (for a correct full recompute)
      const affectedProjects = new Set<string>();
      const projectSessions = new Map<string, string[]>();
      const projectMeta = new Map<string, ProjectMeta>();
      for (const m of sessionMeta.values()) affectedProjects.add(m.project_id);
      for (const pid of affectedProjects) {
        const srows = source
          .prepare('SELECT id FROM session_v2 WHERE project_id = ?')
          .all(pid) as Array<{ id: string }>;
        projectSessions.set(
          pid,
          srows.map((s) => s.id),
        );
        const p = source
          .prepare('SELECT id, name, worktree FROM project WHERE id = ?')
          .get(pid) as ProjectMeta | undefined;
        if (p) projectMeta.set(pid, p);
      }

      // --- prepared statements (compiled once, reused) ---
      const insertMsg = analysis.prepare(`
        INSERT OR REPLACE INTO messages
          (message_id, session_id, time_created, provider_id, model_id, cost, tokens_input, tokens_output, tokens_reasoning, cache_read, cache_write)
        VALUES (@message_id, @session_id, @time_created, @provider_id, @model_id, @cost, @tokens_input, @tokens_output, @tokens_reasoning, @cache_read, @cache_write)
      `);
      const delDaily = analysis.prepare('DELETE FROM daily_agg WHERE day = ?');
      const insDaily = analysis.prepare(`
        INSERT OR REPLACE INTO daily_agg
          (day, provider_id, model_id, msg_count, input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, cost)
        VALUES (@day, @provider_id, @model_id, @msg_count, @input_tokens, @output_tokens, @reasoning_tokens, @cache_read, @cache_write, @cost)
      `);
      const delHourly = analysis.prepare('DELETE FROM hourly_agg WHERE day = ?');
      const insHourly = analysis.prepare(`
        INSERT OR REPLACE INTO hourly_agg (day, hour, msg_count, cost)
        VALUES (@day, @hour, @msg_count, @cost)
      `);
      const sumDay = analysis.prepare(`
        SELECT provider_id, model_id,
               COUNT(*) AS msg_count,
               SUM(tokens_input) AS input_tokens,
               SUM(tokens_output) AS output_tokens,
               SUM(tokens_reasoning) AS reasoning_tokens,
               SUM(cache_read) AS cache_read,
               SUM(cache_write) AS cache_write,
               SUM(cost) AS cost
        FROM messages
        WHERE time_created >= ? AND time_created < ?
        GROUP BY provider_id, model_id
      `);
      const dayMsgs = analysis.prepare(
        'SELECT time_created, cost FROM messages WHERE time_created >= ? AND time_created < ?',
      );
      const delSession = analysis.prepare('DELETE FROM sessions_agg WHERE session_id = ?');
      const insSession = analysis.prepare(`
        INSERT OR REPLACE INTO sessions_agg
          (session_id, project_id, directory, title, model, agent, msg_count, input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, cost, time_created, time_updated)
        VALUES (@session_id, @project_id, @directory, @title, @model, @agent, @msg_count, @input_tokens, @output_tokens, @reasoning_tokens, @cache_read, @cache_write, @cost, @time_created, @time_updated)
      `);
      const sumSession = analysis.prepare(`
        SELECT COUNT(*) AS msg_count,
               SUM(tokens_input) AS input_tokens,
               SUM(tokens_output) AS output_tokens,
               SUM(tokens_reasoning) AS reasoning_tokens,
               SUM(cache_read) AS cache_read,
               SUM(cache_write) AS cache_write,
               SUM(cost) AS cost
        FROM messages WHERE session_id = ?
      `);
      const delProject = analysis.prepare('DELETE FROM project_agg WHERE project_id = ?');
      const insProject = analysis.prepare(`
        INSERT OR REPLACE INTO project_agg
          (project_id, directory, name, session_count, msg_count, input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, cost, last_activity_at)
        VALUES (@project_id, @directory, @name, @session_count, @msg_count, @input_tokens, @output_tokens, @reasoning_tokens, @cache_read, @cache_write, @cost, @last_activity_at)
      `);
      const setMeta = analysis.prepare(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
      );

      function sumForSessions(ids: string[]): SumRow {
        const acc: {
          msg_count: number;
          session_count: number;
          input_tokens: number;
          output_tokens: number;
          reasoning_tokens: number;
          cache_read: number;
          cache_write: number;
          cost: number;
          max_time: number;
        } = {
          msg_count: 0,
          session_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
          cache_read: 0,
          cache_write: 0,
          cost: 0,
          max_time: 0,
        };
        for (const c of chunk(ids, 500)) {
          const ph = c.map(() => '?').join(',');
          const r = analysis
            .prepare(
              `SELECT COUNT(DISTINCT session_id) AS session_count, COUNT(*) AS msg_count,
                      SUM(tokens_input) AS input_tokens, SUM(tokens_output) AS output_tokens,
                      SUM(tokens_reasoning) AS reasoning_tokens, SUM(cache_read) AS cache_read,
                      SUM(cache_write) AS cache_write, SUM(cost) AS cost, MAX(time_created) AS max_time
               FROM messages WHERE session_id IN (${ph})`,
            )
            .get(...c) as SumRow;
          acc.msg_count += r.msg_count;
          acc.session_count += r.session_count ?? 0;
          acc.input_tokens += r.input_tokens ?? 0;
          acc.output_tokens += r.output_tokens ?? 0;
          acc.reasoning_tokens += r.reasoning_tokens ?? 0;
          acc.cache_read += r.cache_read ?? 0;
          acc.cache_write += r.cache_write ?? 0;
          acc.cost += r.cost ?? 0;
          acc.max_time = Math.max(acc.max_time, r.max_time ?? 0);
        }
        return acc;
      }

      // --- write (single transaction) ---
      const write = analysis.transaction(() => {
        for (const it of items) insertMsg.run(it);

        // daily_agg + hourly_agg for affected days (recomputed from messages)
        for (const day of affectedDays) {
          const { start, end } = dayRange(day);
          delDaily.run(day);
          for (const r of sumDay.all(start, end) as Array<
            SumRow & { provider_id: string; model_id: string }
          >) {
            insDaily.run({
              day,
              provider_id: r.provider_id,
              model_id: r.model_id,
              msg_count: r.msg_count,
              input_tokens: r.input_tokens ?? 0,
              output_tokens: r.output_tokens ?? 0,
              reasoning_tokens: r.reasoning_tokens ?? 0,
              cache_read: r.cache_read ?? 0,
              cache_write: r.cache_write ?? 0,
              cost: r.cost ?? 0,
            });
          }
          delHourly.run(day);
          const byHour = new Map<number, { msg_count: number; cost: number }>();
          for (const m of dayMsgs.all(start, end) as Array<{
            time_created: number;
            cost: number;
          }>) {
            const h = localHour(m.time_created);
            const e = byHour.get(h) ?? { msg_count: 0, cost: 0 };
            e.msg_count += 1;
            e.cost += m.cost;
            byHour.set(h, e);
          }
          for (const [h, v] of byHour) {
            insHourly.run({ day, hour: h, msg_count: v.msg_count, cost: v.cost });
          }
        }

        // sessions_agg for affected (non-orphan) sessions
        for (const sid of sessionIds) {
          const meta = sessionMeta.get(sid);
          if (!meta) continue; // orphan: skip (no session_v2 metadata)
          delSession.run(sid);
          const s = sumSession.get(sid) as SumRow;
          let modelId = '';
          if (meta.model) {
            try {
              const m = JSON.parse(meta.model) as { id?: string };
              modelId = m.id ?? '';
            } catch {
              modelId = '';
            }
          }
          insSession.run({
            session_id: sid,
            project_id: meta.project_id,
            directory: meta.directory,
            title: meta.title,
            model: modelId,
            agent: meta.agent,
            msg_count: s.msg_count,
            input_tokens: s.input_tokens ?? 0,
            output_tokens: s.output_tokens ?? 0,
            reasoning_tokens: s.reasoning_tokens ?? 0,
            cache_read: s.cache_read ?? 0,
            cache_write: s.cache_write ?? 0,
            cost: s.cost ?? 0,
            time_created: meta.time_created,
            time_updated: meta.time_updated,
          });
        }

        // project_agg for affected projects (full recompute from messages)
        for (const pid of affectedProjects) {
          const ids = projectSessions.get(pid) ?? [];
          const pm = projectMeta.get(pid);
          delProject.run(pid);
          if (ids.length === 0) {
            insProject.run({
              project_id: pid,
              directory: pm?.worktree ?? '',
              name: pm?.name ?? null,
              session_count: 0,
              msg_count: 0,
              input_tokens: 0,
              output_tokens: 0,
              reasoning_tokens: 0,
              cache_read: 0,
              cache_write: 0,
              cost: 0,
              last_activity_at: 0,
            });
            continue;
          }
          const p = sumForSessions(ids);
          insProject.run({
            project_id: pid,
            directory: pm?.worktree ?? '',
            name: pm?.name ?? null,
            session_count: p.session_count ?? 0,
            msg_count: p.msg_count,
            input_tokens: p.input_tokens ?? 0,
            output_tokens: p.output_tokens ?? 0,
            reasoning_tokens: p.reasoning_tokens ?? 0,
            cache_read: p.cache_read ?? 0,
            cache_write: p.cache_write ?? 0,
            cost: p.cost ?? 0,
            last_activity_at: p.max_time ?? 0,
          });
        }

        setMeta.run('last_sync', String(maxTime));
        setMeta.run('source_db', SOURCE_DB);
      });
      write();

      return { newMessages: rawMsgs.length, durationMs: Date.now() - startedAt, full };
    } finally {
      source.close();
    }
  } finally {
    analysis.close();
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
function main(): void {
  const full = process.argv.includes('--full');
  const res = sync({ full });
  console.log(
    `[extract] ${res.full ? 'FULL rebuild' : 'incremental'} — ${res.newMessages} new message(s) in ${res.durationMs} ms (${(res.durationMs / 1000).toFixed(2)}s)`,
  );
}

const arg1 = process.argv[1];
const isMain = arg1 !== undefined && import.meta.url === pathToFileURL(arg1).href;
if (isMain) main();
