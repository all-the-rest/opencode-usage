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
 * Retention: the ONLY code in this project that ever writes to the source DB is
 * scripts/prune-source.ts (deletes old messages once stats.db holds them). A
 * full rebuild after a prune is refused unless explicitly forced — it would
 * silently drop the pruned history from stats.db (see the guard in sync()).
 *
 * Incremental sync: only messages with time_created >= last_sync are processed
 * (idempotent via INSERT OR REPLACE on message_id); the affected aggregate keys
 * (sessions_agg / daily_agg / hourly_agg / project_agg) are recomputed via
 * DELETE + INSERT from the messages table.
 *
 * daily_agg / hourly_agg carry a `directory` dimension (session_v2.directory per
 * message; orphans => "") so the server can filter every stat by project dir.
 * If an existing DB has the old schema (no `directory` column), the tables are
 * dropped, recreated with the new shape, and a full rebuild is forced.
 */

import Database from 'better-sqlite3';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(scriptDir, '..');

// Env-Overrides (SOURCE_DB_PATH / STATS_DB_PATH) gibt es NUR für Tests gegen
// Kopien/Fixtures der echten DBs (siehe scripts/test-prune.ts) — im normalen
// Betrieb niemals setzen.
export const SOURCE_DB =
  process.env.SOURCE_DB_PATH ?? path.join(os.homedir(), '.local/share/opencode/opencode.db');
export const ANALYSIS_DB =
  process.env.STATS_DB_PATH ?? path.join(PROJECT_ROOT, 'data', 'stats.db');

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

/** meta-Wert aus der Analyse-DB lesen (null, wenn nicht gesetzt). */
function metaValue(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/** Kompakter lokaler Zeitstempel für Meldungen (YYYY-MM-DD HH:MM). */
function localStampMs(ms: number): string {
  const d = new Date(ms);
  return `${localDay(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
      day TEXT NOT NULL,                   -- YYYY-MM-DD (lokale Zeit)
      directory TEXT NOT NULL,             -- session_v2.directory je message; Orphans => ''
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (day, directory, provider_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS hourly_agg (
      day TEXT NOT NULL,                   -- YYYY-MM-DD lokal
      hour INTEGER NOT NULL,               -- 0-23 lokal
      directory TEXT NOT NULL,             -- session_v2.directory je message; Orphans => ''
      msg_count INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (day, hour, directory)
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
export function sync(
  opts: {
    full?: boolean;
    /** Full-Rebuild nach einem Prune bewusst erzwingen (--force). */
    force?: boolean;
    /** Pfade nur für Tests gegen Fixtures; Default: SOURCE_DB / ANALYSIS_DB. */
    sourceDb?: string;
    analysisDb?: string;
  } = {},
): SyncResult {
  const startedAt = Date.now();
  let full = opts.full === true;
  const sourceDb = opts.sourceDb ?? SOURCE_DB;
  const analysisDb = opts.analysisDb ?? ANALYSIS_DB;

  fs.mkdirSync(path.dirname(analysisDb), { recursive: true });
  const analysis = new Database(analysisDb);
  try {
    analysis.pragma('journal_mode = WAL');
    initAnalysisDb(analysis);

    // --- schema migration: daily_agg / hourly_agg gained a `directory`
    // dimension. If an existing DB still uses the old schema (no `directory`
    // column), drop + recreate those two tables and force a full rebuild so
    // every aggregate is recomputed with the new shape. Self-healing, no
    // separate version number required (the directory column is the signal).
    const dailySql = (
      analysis.prepare("SELECT sql FROM sqlite_master WHERE name = 'daily_agg'").get() as
        | { sql: string | null }
        | undefined
    )?.sql;
    const needsMigration = dailySql != null && !dailySql.includes('directory');
    if (needsMigration) {
      analysis.exec('DROP TABLE IF EXISTS daily_agg; DROP TABLE IF EXISTS hourly_agg;');
      initAnalysisDb(analysis);
      full = true;
    }

    let lastSync: number;
    if (full) {
      // Retention-Guard (meta.source_pruned_until, gesetzt von
      // scripts/prune-source.ts): Nach dem Löschen alter Messages in der Quelle
      // würde ein Full-Rebuild die gelöschte History still aus stats.db
      // entfernen. Wir vergleichen bewusst NICHT MIN(time_created) der Quelle:
      // nach einem Prune liegt das Minimum immer am/über dem Cutoff (und MIN
      // über alle types wäre ohnehin nur ein grober Proxy — der Extractor zählt
      // nur type='assistant'). Die Faustregel ist deshalb konservativ: JEDEr
      // Full-Rebuild nach einem Prune braucht --force (z. B. nach Restore aus
      // einem Archiv). Inkrementelle Syncs sind nie betroffen.
      const prunedUntilRaw = metaValue(analysis, 'source_pruned_until');
      if (prunedUntilRaw != null) {
        const ms = Number(prunedUntilRaw);
        const when = Number.isFinite(ms) ? localStampMs(ms) : prunedUntilRaw;
        if (!opts.force) {
          throw new Error(
            `[extract] FULL-Rebuild verweigert: Die Quelle wurde bis ${when} gekürzt ` +
              '(stats.db meta.source_pruned_until). Ein Full-Rebuild würde diese History ' +
              'endgültig aus stats.db entfernen. Quelle aus einem Delta-Archiv ' +
              '(opencode-prune-archive-*.db) wiederherstellen und erneut laufen ' +
              'lassen — oder bewusst mit --force bzw. sync({ force: true }) erzwingen.',
          );
        }
        console.warn(
          `[extract] --force: Full-Rebuild trotz source_pruned_until = ${when} — die vor ` +
            'dem Prune gelöschte History wird aus stats.db entfernt.',
        );
      }
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

    // --- read source (STRICT read-only): v2 schema (session_message only) ---
    // The legacy `message` table was fully migrated into `session_message`
    // (FK -> session_v2). The 31 ids remaining solely in `message` are
    // migration artifacts (a stale client left open) and are out of scope.
    const source = new Database(sourceDb, { fileMustExist: true, readonly: true });
    try {
      // session -> directory map (ALL sessions) for per-message directory
      // attribution in daily_agg / hourly_agg. Orphan messages (session not in
      // session_v2) resolve to "" (documented in docs/stats-db-schema.md).
      const sessionDir = new Map<string, string>();
      for (const r of source
        .prepare('SELECT id, directory FROM session_v2')
        .all() as Array<{ id: string; directory: string }>) {
        sessionDir.set(r.id, r.directory);
      }

      // Streaming statt .all(): jede Zeile trägt ein ~55-KB-JSON (`data`) — bei
      // 90k+ Messages materialisiert .all() mehrere GB Heap (OOM im Full-Rebuild,
      // auch nach Prune: allein August = 71k Messages). iterate() hält nur die
      // kompakte Projektion in `items` (~200 B/Zeile), die Raw-Zeile wird pro
      // Iteration GC-fähig.
      const selectMsgs = source.prepare(`
        SELECT id, session_id, time_created, data
        FROM session_message
        WHERE time_created >= ?
          AND type = 'assistant'
          AND json_extract(data, '$.tokens') IS NOT NULL
        ORDER BY time_created ASC
      `);

      const items: Array<Record<string, unknown>> = [];
      const affectedSessions = new Set<string>();
      const affectedDays = new Set<string>();
      let maxTime = lastSync;
      let newMessages = 0;

      for (const r of selectMsgs.iterate(lastSync) as IterableIterator<SourceMessageRow>) {
        let data: any;
        try {
          data = JSON.parse(r.data);
        } catch {
          continue;
        }
        if (!data.tokens) continue;
        const t = data.tokens;
        const cache = t.cache ?? {};
        // v2 nests model under data.model (data.model.providerID / data.model.id)
        const model = data.model ?? {};
        items.push({
          message_id: r.id,
          session_id: r.session_id,
          time_created: r.time_created,
          provider_id: model.providerID ?? '',
          model_id: model.id ?? '',
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
        newMessages++;
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
          (day, directory, provider_id, model_id, msg_count, input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, cost)
        VALUES (@day, @directory, @provider_id, @model_id, @msg_count, @input_tokens, @output_tokens, @reasoning_tokens, @cache_read, @cache_write, @cost)
      `);
      const delHourly = analysis.prepare('DELETE FROM hourly_agg WHERE day = ?');
      const insHourly = analysis.prepare(`
        INSERT OR REPLACE INTO hourly_agg (day, hour, directory, msg_count, cost)
        VALUES (@day, @hour, @directory, @msg_count, @cost)
      `);
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

        // daily_agg + hourly_agg for affected days (recomputed from messages,
        // attributed to each message's session directory; orphans => "").
        const dayMsgStmt = analysis.prepare(`
          SELECT session_id, provider_id, model_id, cost, tokens_input, tokens_output,
                 tokens_reasoning, cache_read, cache_write, time_created
          FROM messages WHERE time_created >= ? AND time_created < ?
        `);
        for (const day of affectedDays) {
          const { start, end } = dayRange(day);
          const rows = dayMsgStmt.all(start, end) as Array<{
            session_id: string;
            provider_id: string;
            model_id: string;
            cost: number;
            tokens_input: number;
            tokens_output: number;
            tokens_reasoning: number;
            cache_read: number;
            cache_write: number;
            time_created: number;
          }>;

          const dailyMap = new Map<
            string,
            {
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
          >();
          const hourlyMap = new Map<
            string,
            { day: string; directory: string; hour: number; msg_count: number; cost: number }
          >();

          for (const m of rows) {
            const dir = sessionDir.get(m.session_id) ?? '';
            const dk = `${dir} ${m.provider_id} ${m.model_id}`;
            let d = dailyMap.get(dk);
            if (!d) {
              d = {
                day,
                directory: dir,
                provider_id: m.provider_id,
                model_id: m.model_id,
                msg_count: 0,
                input_tokens: 0,
                output_tokens: 0,
                reasoning_tokens: 0,
                cache_read: 0,
                cache_write: 0,
                cost: 0,
              };
              dailyMap.set(dk, d);
            }
            d.msg_count += 1;
            d.input_tokens += m.tokens_input;
            d.output_tokens += m.tokens_output;
            d.reasoning_tokens += m.tokens_reasoning;
            d.cache_read += m.cache_read;
            d.cache_write += m.cache_write;
            d.cost += m.cost;

            const h = localHour(m.time_created);
            const hk = `${dir} ${h}`;
            let hh = hourlyMap.get(hk);
            if (!hh) {
              hh = { day, directory: dir, hour: h, msg_count: 0, cost: 0 };
              hourlyMap.set(hk, hh);
            }
            hh.msg_count += 1;
            hh.cost += m.cost;
          }

          delDaily.run(day);
          for (const d of dailyMap.values()) insDaily.run(d);
          delHourly.run(day);
          for (const h of hourlyMap.values()) insHourly.run(h);
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
        setMeta.run('source_db', sourceDb);
      });
      write();

      return { newMessages, durationMs: Date.now() - startedAt, full };
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
  const force = process.argv.includes('--force');
  const res = sync({ full, force });
  console.log(
    `[extract] ${res.full ? 'FULL rebuild' : 'incremental'} — ${res.newMessages} new message(s) in ${res.durationMs} ms (${(res.durationMs / 1000).toFixed(2)}s)`,
  );
}

const arg1 = process.argv[1];
const isMain = arg1 !== undefined && import.meta.url === pathToFileURL(arg1).href;
if (isMain) main();
