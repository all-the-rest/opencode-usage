/**
 * Fixture-Tests für die Quell-DB-Retention (prune-source.ts + extract.ts-Guard).
 *
 * Läuft NUR gegen synthetische Fixtures in einem frischen OS-Temp-Verzeichnis
 * (fs.mkdtempSync) und berührt NIEMALS die echte ~/.local/share/opencode/
 * opencode.db oder data/stats.db: alle Pfade werden explizit an sync() und
 * pruneSource() übergeben — Env-Overrides (SOURCE_DB_PATH/STATS_DB_PATH)
 * spielen hier keine Rolle.
 *
 * Szenarien:
 *  1. Determinismus      — Full-Sync → Snapshot → Prune → inkrementeller Sync ⇒ identisch
 *  2. Monats-Simulation  — alte Monate weg aus der Quelle, vollständig in stats.db
 *  3. Live-Verkehr       — neue Message nach dem Prune, Aggregates ALT+NEU korrekt
 *  4. Idempotenz         — 2. Prune-Lauf löscht 0 und macht kein neues Backup
 *  5. Full-Guard         — sync({full}) verweigert ohne --force, läuft mit --force
 *  6. Preflight-Mismatch — manipulierte stats.db ⇒ Abbruch, Quelle unangetastet
 *  7. Dry-Run            — Default (ohne --yes) ändert NICHTS (kein Backup, keine meta-Writes)
 *  8. Retention 1 vs 2   — konfigurierbare Kalendermonate (Default 2; 1 = enger per --months)
 *
 * pnpm test:prune
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sync } from './extract';
import { pruneSource, resolveCutoffMs, resolveRetentionMonths } from './prune-source';

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// tiny assert framework
// ---------------------------------------------------------------------------
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg} (erwartet ${String(expected)}, erhalten ${String(actual)})`);
  }
}
function assertClose(actual: number, expected: number, msg: string): void {
  // für cost-Summen (REAL): relative Toleranz
  if (Math.abs(actual - expected) > 1e-9 * Math.max(1, Math.abs(expected))) {
    throw new Error(`${msg} (erwartet ~${String(expected)}, erhalten ${String(actual)})`);
  }
}

// ---------------------------------------------------------------------------
// fixture: synthetische Quell-DB (Minimal-Schema analog zur echten Quelle)
// ---------------------------------------------------------------------------
interface FixtureMsg {
  id: string;
  sessionId: string;
  type: string;
  time: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface Fixture {
  root: string;
  sourceDb: string;
  statsDb: string;
  backupPath: string;
  /** Cutoff = 1. des AKTUELLEN Monats (Retention 1). */
  cutoff: number;
  tOld: number; // < cutoff → wird gelöscht
  tMid: number; // >= cutoff, sicher vor tNew → bleibt
  tNew: number; // aktuellste Zeit → bleibt
}

const tempRoots: string[] = [];

function msgData(m: {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}): string {
  return JSON.stringify({
    tokens: {
      input: m.input,
      output: m.output,
      reasoning: m.reasoning,
      cache: { read: m.cacheRead, write: m.cacheWrite },
    },
    model: { providerID: 'test-provider', id: 'test-model' },
    cost: m.cost,
  });
}

function createSourceDb(sourceDb: string): Database.Database {
  const db = new Database(sourceDb);
  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      name TEXT,
      worktree TEXT
    );
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT,
      model TEXT,
      agent TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES session_v2(id) ON DELETE CASCADE,
      type TEXT,
      seq INTEGER,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
    CREATE INDEX session_message_time_idx ON session_message(time_created);
  `);
  return db;
}

function insertSessions(
  db: Database.Database,
  sessions: Array<{ id: string; projectId: string; directory: string; time: number }>,
): void {
  const insProject = db.prepare('INSERT INTO project (id, name, worktree) VALUES (?, ?, ?)');
  const insSession = db.prepare(
    'INSERT INTO session_v2 (id, project_id, directory, title, model, agent, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const s of sessions) {
    insProject.run(s.projectId, `Project ${s.projectId}`, s.directory);
    insSession.run(s.id, s.projectId, s.directory, `Session ${s.id}`, null, 'build', s.time, s.time);
  }
}

function insertMessages(db: Database.Database, messages: FixtureMsg[]): void {
  const ins = db.prepare(
    'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  messages.forEach((m, i) => {
    ins.run(m.id, m.sessionId, m.type, i + 1, m.time, m.time, m.type === 'assistant' ? msgData(m) : '{}');
  });
}

/**
 * Standard-Fixture: 2 Sessions in 2 Projekten, Messages in drei Zeitbereichen
 * relativ zum Cutoff (1. des aktuellen Monats). tNew liegt garantiert >= jetzt,
 * damit inkrementelle Syncs (time_created >= last_sync) die Live-Message in
 * Szenario 3 immer noch verarbeiten — egal an welchem Kalendertag der Test läuft.
 */
function makeStandardFixture(tag: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `opencode-prune-${tag}-`));
  tempRoots.push(root);
  const now = Date.now();
  const cutoff = resolveCutoffMs({ months: 1 }, now); // 1. des aktuellen Monats
  const tOld = cutoff - 30 * DAY; // Vormonat (oder älter) → wird gelöscht
  const tMid = cutoff + DAY; // sicher im Behalte-Fenster
  const tNew = Math.max(now, cutoff + 2 * DAY); // aktuellste Zeit, unique
  const sourceDb = path.join(root, 'opencode.db');
  const db = createSourceDb(sourceDb);
  try {
    insertSessions(db, [
      { id: 's1', projectId: 'p1', directory: '/fixture/a', time: tOld },
      { id: 's2', projectId: 'p2', directory: '/fixture/b', time: tOld },
    ]);
    insertMessages(db, [
      { id: 'm1', sessionId: 's1', type: 'assistant', time: tOld, input: 1000, output: 100, reasoning: 50, cacheRead: 2000, cacheWrite: 300, cost: 0.01 },
      { id: 'm1-user', sessionId: 's1', type: 'user', time: tOld + 1, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      { id: 'm4', sessionId: 's2', type: 'assistant', time: tOld + 2, input: 1300, output: 130, reasoning: 80, cacheRead: 2300, cacheWrite: 330, cost: 0.04 },
      { id: 'm2', sessionId: 's1', type: 'assistant', time: tMid, input: 1100, output: 110, reasoning: 60, cacheRead: 2100, cacheWrite: 310, cost: 0.02 },
      { id: 'm5', sessionId: 's2', type: 'assistant', time: tMid + 1, input: 1400, output: 140, reasoning: 90, cacheRead: 2400, cacheWrite: 340, cost: 0.05 },
      { id: 'm3', sessionId: 's1', type: 'assistant', time: tNew, input: 1200, output: 120, reasoning: 70, cacheRead: 2200, cacheWrite: 320, cost: 0.03 },
    ]);
  } finally {
    db.close();
  }
  return {
    root,
    sourceDb,
    statsDb: path.join(root, 'stats.db'),
    backupPath: path.join(root, 'opencode-backup-test.db'),
    cutoff,
    tOld,
    tMid,
    tNew,
  };
}

// ---------------------------------------------------------------------------
// query helpers (alles read-only, außer der Live-Insert in Szenario 3)
// ---------------------------------------------------------------------------
function withRo<T>(p: string, fn: (db: Database.Database) => T): T {
  const db = new Database(p, { fileMustExist: true, readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function countRows(db: Database.Database, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n: number };
  return row.n;
}

function countMessages(statsDb: string): number {
  return withRo(statsDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM messages'));
}

function readMetaMap(statsDb: string): Record<string, string> {
  return withRo(statsDb, (db) => {
    const rows = db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    // kanonische Reihenfolge (INSERT OR REPLACE ändert die Row-Order)
    const sorted: Record<string, string> = {};
    for (const k of Object.keys(out).sort()) sorted[k] = out[k] ?? '';
    return sorted;
  });
}

interface SessionsAggRow {
  msg_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
}

function sessionsAggRow(statsDb: string, sessionId: string): SessionsAggRow {
  return withRo(statsDb, (db) => {
    const row = db
      .prepare('SELECT * FROM sessions_agg WHERE session_id = ?')
      .get(sessionId) as SessionsAggRow | undefined;
    assert(row != null, `sessions_agg Zeile für ${sessionId} vorhanden`);
    return row;
  });
}

/** Snapshot aller Aggregate + Message-Totale (für Szenario 1). */
function snapshot(statsDb: string): string {
  return withRo(statsDb, (db) => {
    const totals = db.prepare(
      'SELECT COUNT(*) AS msg_count, SUM(tokens_input) AS input_tokens, SUM(tokens_output) AS output_tokens, SUM(tokens_reasoning) AS reasoning_tokens, SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write, SUM(cost) AS cost FROM messages',
    ).get();
    const daily = db
      .prepare('SELECT * FROM daily_agg ORDER BY day, directory, provider_id, model_id')
      .all();
    const hourly = db.prepare('SELECT * FROM hourly_agg ORDER BY day, hour, directory').all();
    const sessions = db.prepare('SELECT * FROM sessions_agg ORDER BY session_id').all();
    const projects = db.prepare('SELECT * FROM project_agg ORDER BY project_id').all();
    return JSON.stringify({ totals, daily, hourly, sessions, projects });
  });
}

// ---------------------------------------------------------------------------
// Szenarien
// ---------------------------------------------------------------------------
function scenarioDeterminism(): void {
  const f = makeStandardFixture('det');
  const r0 = sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });
  assertEqual(r0.newMessages, 5, 'Full-Sync verarbeitet alle 5 Assistant-Messages');
  const snap1 = snapshot(f.statsDb);

  const pr = pruneSource({
    yes: true,
    cutoffMs: f.cutoff,
    sourceDb: f.sourceDb,
    analysisDb: f.statsDb,
    backupPath: f.backupPath,
  });
  assertEqual(pr.deleted, 3, 'Prune löscht 3 Zeilen (m1, m1-user, m4)');
  assert(pr.preflight != null && pr.preflight.ok, 'Preflight ok');
  assertEqual(pr.backupPath, f.backupPath, 'Backup-Pfad gesetzt');
  assert(fs.existsSync(f.backupPath), 'Backup-Datei existiert');
  assert((pr.bytes ?? 0) > 0, 'geschätzte Größe > 0');
  assertEqual(pr.oldestRemaining, f.tMid, 'älteste verbleibende Message = tMid');

  const r1 = sync({ sourceDb: f.sourceDb, analysisDb: f.statsDb });
  const snap2 = snapshot(f.statsDb);
  assertEqual(snap2, snap1, 'Aggregate-Snapshot nach Prune + Sync identisch');
  // Der Extractor liest inkrementell time_created >= last_sync und verarbeitet
  // damit die aktuellste Message erneut (>=-Grenze). Die eigentliche Invariante
  // ist: KEINE neue Message kommt hinzu (Snapshot identisch, Message-Menge
  // unverändert) — newMessages ist genau die eine Boundary-Message.
  assertEqual(r1.newMessages, 1, 'inkrementeller Sync re-verarbeitet nur die Boundary-Message');
  assertEqual(countMessages(f.statsDb), 5, 'stats.db behält alle 5 Messages');
}

function scenarioMonthSimulation(): void {
  const f = makeStandardFixture('months');
  sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });
  pruneSource({
    yes: true,
    cutoffMs: f.cutoff,
    sourceDb: f.sourceDb,
    analysisDb: f.statsDb,
    backupPath: f.backupPath,
  });

  // Quelle: alles vor dem Cutoff ist weg (inkl. user-Message), Sessions bleiben.
  assertEqual(
    withRo(f.sourceDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM session_message WHERE time_created < ?', f.cutoff)),
    0,
    'Quelle: keine Zeilen mehr vor dem Cutoff',
  );
  assertEqual(
    withRo(f.sourceDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM session_message WHERE time_created >= ?', f.cutoff)),
    3,
    'Quelle: 3 Zeilen (m2, m5, m3) bleiben',
  );
  assertEqual(
    withRo(f.sourceDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM session_v2')),
    2,
    'Quelle: session_v2 unberührt (V1 behält Sessions)',
  );

  // stats.db: alle drei "Monate" vollständig.
  assertEqual(countMessages(f.statsDb), 5, 'stats.db: alle 5 Messages vorhanden');
  withRo(f.statsDb, (db) => {
    const t = db
      .prepare(
        'SELECT SUM(tokens_input) AS input, SUM(tokens_output) AS output, SUM(tokens_reasoning) AS reasoning, SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write, SUM(cost) AS cost FROM messages',
      )
      .get() as Record<string, number | null>;
    assertEqual(t.input ?? -1, 6000, 'stats.db: tokens_input-Total');
    assertEqual(t.output ?? -1, 600, 'stats.db: tokens_output-Total');
    assertEqual(t.reasoning ?? -1, 350, 'stats.db: tokens_reasoning-Total');
    assertEqual(t.cache_read ?? -1, 11000, 'stats.db: cache_read-Total');
    assertEqual(t.cache_write ?? -1, 1600, 'stats.db: cache_write-Total');
    assertClose(t.cost ?? -1, 0.15, 'stats.db: cost-Total');
  });
}

function scenarioLiveTraffic(): void {
  const f = makeStandardFixture('live');
  sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });
  pruneSource({
    yes: true,
    cutoffMs: f.cutoff,
    sourceDb: f.sourceDb,
    analysisDb: f.statsDb,
    backupPath: f.backupPath,
  });
  assertEqual(countMessages(f.statsDb), 5, 'stats.db hat die 5 Fixture-Messages');

  // Live-Verkehr: neue Message in s1, dessen alte Messages gelöscht wurden.
  const liveTime = f.tNew + 60_000; // strikt > last_sync (tNew) → wird verarbeitet
  const live = {
    input: 1500,
    output: 150,
    reasoning: 95,
    cacheRead: 2500,
    cacheWrite: 350,
    cost: 0.06,
  };
  const src = new Database(f.sourceDb);
  try {
    src
      .prepare(
        'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('m-live', 's1', 'assistant', 99, liveTime, liveTime, msgData(live));
  } finally {
    src.close();
  }

  sync({ sourceDb: f.sourceDb, analysisDb: f.statsDb });

  assertEqual(countMessages(f.statsDb), 6, 'genau EINE neue Message verarbeitet (5 → 6)');
  withRo(f.statsDb, (db) => {
    const row = db
      .prepare('SELECT tokens_input AS input, cost FROM messages WHERE message_id = ?')
      .get('m-live') as { input: number; cost: number } | undefined;
    assert(row != null, 'm-live in stats.db vorhanden');
    assertEqual(row.input, 1500, 'm-live: tokens_input korrekt extrahiert');
    assertClose(row.cost, 0.06, 'm-live: cost korrekt extrahiert');
  });

  // sessions_agg für s1 = ALT+NEU korrekt: die ALTEN Messages (m1 wurde in der
  // Quelle gelöscht, lebt nur noch in stats.db) plus m2/m3 (blieben) plus NEU
  // (m-live) — die Summen müssen ALT+NEU exakt abbilden.
  const s1 = sessionsAggRow(f.statsDb, 's1');
  assertEqual(s1.msg_count, 4, 'sessions_agg s1: ALT (m1+m2+m3) + NEU (m-live)');
  assertEqual(s1.input_tokens, 1000 + 1100 + 1200 + 1500, 'sessions_agg s1: input alt+neu');
  assertEqual(s1.output_tokens, 100 + 110 + 120 + 150, 'sessions_agg s1: output alt+neu');
  assertEqual(s1.reasoning_tokens, 50 + 60 + 70 + 95, 'sessions_agg s1: reasoning alt+neu');
  assertEqual(s1.cache_read, 2000 + 2100 + 2200 + 2500, 'sessions_agg s1: cache_read alt+neu');
  assertEqual(s1.cache_write, 300 + 310 + 320 + 350, 'sessions_agg s1: cache_write alt+neu');
  assertClose(s1.cost, 0.01 + 0.02 + 0.03 + 0.06, 'sessions_agg s1: cost alt+neu');

  // Aggregat-Invarianten: jede Message landet in genau einem daily/hourly-Bucket.
  assertEqual(
    withRo(f.statsDb, (db) => countRows(db, 'SELECT SUM(msg_count) AS n FROM daily_agg')),
    6,
    'daily_agg deckt alle 6 Messages ab',
  );
  assertEqual(
    withRo(f.statsDb, (db) => countRows(db, 'SELECT SUM(msg_count) AS n FROM hourly_agg')),
    6,
    'hourly_agg deckt alle 6 Messages ab',
  );
  withRo(f.statsDb, (db) => {
    const p1 = db.prepare('SELECT * FROM project_agg WHERE project_id = ?').get('p1') as {
      msg_count: number;
      cost: number;
    };
    assertEqual(p1.msg_count, 4, 'project_agg p1: m1+m2+m3+m-live');
    assertClose(p1.cost, 0.01 + 0.02 + 0.03 + 0.06, 'project_agg p1: cost');
  });
}

function scenarioIdempotency(): void {
  const f = makeStandardFixture('idem');
  sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });
  const pr1 = pruneSource({
    yes: true,
    cutoffMs: f.cutoff,
    sourceDb: f.sourceDb,
    analysisDb: f.statsDb,
    backupPath: f.backupPath,
  });
  assertEqual(pr1.deleted, 3, 'erster Lauf löscht 3');
  assert(fs.existsSync(f.backupPath), 'Backup existiert nach erstem Lauf');
  const stat1 = fs.statSync(f.backupPath);
  const meta1 = JSON.stringify(readMetaMap(f.statsDb));

  const pr2 = pruneSource({
    yes: true,
    cutoffMs: f.cutoff,
    sourceDb: f.sourceDb,
    analysisDb: f.statsDb,
    backupPath: f.backupPath,
  });
  assertEqual(pr2.deleted, 0, 'zweiter Lauf löscht 0');
  assertEqual(pr2.candidates, 0, 'zweiter Lauf findet 0 Kandidaten');
  assertEqual(pr2.backupPath, null, 'zweiter Lauf macht kein Backup');
  const stat2 = fs.statSync(f.backupPath);
  assertEqual(stat2.mtimeMs, stat1.mtimeMs, 'Backup-Datei unangetastet (kein neues Backup)');
  assertEqual(JSON.stringify(readMetaMap(f.statsDb)), meta1, 'meta unangetastet');
}

function scenarioFullGuard(): void {
  const f = makeStandardFixture('guard');
  sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });
  pruneSource({
    yes: true,
    cutoffMs: f.cutoff,
    sourceDb: f.sourceDb,
    analysisDb: f.statsDb,
    backupPath: f.backupPath,
  });

  let err: unknown;
  let threw = false;
  try {
    sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });
  } catch (e) {
    threw = true;
    err = e;
  }
  assert(threw, 'sync({full}) nach Prune wird verweigert (wirft)');
  const msg = err instanceof Error ? err.message : String(err);
  assert(msg.includes('force'), 'Meldung verweist auf --force');
  assert(msg.includes('source_pruned_until'), 'Meldung nennt source_pruned_until');

  sync({ full: true, force: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });
  assertEqual(
    countMessages(f.statsDb),
    3,
    'forced Full-Rebuild kennt nur die 3 verbleibenden Quell-Messages (m2, m5, m3)',
  );
}

function scenarioPreflightMismatch(): void {
  const f = makeStandardFixture('mismatch');
  sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });

  // stats.db künstlich verarmen: eine alte Message aus messages löschen.
  const db = new Database(f.statsDb);
  try {
    db.prepare("DELETE FROM messages WHERE message_id = 'm1'").run();
  } finally {
    db.close();
  }

  let threw = false;
  try {
    pruneSource({
      yes: true,
      cutoffMs: f.cutoff,
      sourceDb: f.sourceDb,
      analysisDb: f.statsDb,
      backupPath: f.backupPath,
    });
  } catch (e) {
    threw = true;
    const msg = e instanceof Error ? e.message : String(e);
    assert(msg.includes('Preflight'), 'Abbruch wegen Preflight-Mismatch');
  }
  assert(threw, 'Prune bricht bei stats.db-Drift ab');

  assertEqual(
    withRo(f.sourceDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM session_message WHERE time_created < ?', f.cutoff)),
    3,
    'Quelle unangetastet (m1, m1-user, m4 noch da)',
  );
  assert(!fs.existsSync(f.backupPath), 'kein Backup erstellt');
}

function scenarioDryRun(): void {
  const f = makeStandardFixture('dry');
  sync({ full: true, sourceDb: f.sourceDb, analysisDb: f.statsDb });

  const pr = pruneSource({
    cutoffMs: f.cutoff, // absichtlich OHNE yes → Dry-Run
    sourceDb: f.sourceDb,
    analysisDb: f.statsDb,
    backupPath: f.backupPath,
  });
  assertEqual(pr.dryRun, true, 'Dry-Run flag gesetzt');
  assertEqual(pr.candidates, 3, 'Dry-Run meldet 3 Kandidaten');
  assertEqual(pr.deleted, 0, 'Dry-Run löscht nichts');
  assertEqual(pr.backupPath, null, 'Dry-Run macht kein Backup');
  assert(!fs.existsSync(f.backupPath), 'keine Backup-Datei');
  assertEqual(
    withRo(f.sourceDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM session_message WHERE time_created < ?', f.cutoff)),
    3,
    'Quelle unangetastet',
  );
  const meta = readMetaMap(f.statsDb);
  assert(!('source_pruned_until' in meta), 'kein source_pruned_until geschrieben');
  assert(!('source_pruned_at' in meta), 'kein source_pruned_at geschrieben');
  assert(!('source_retention_months' in meta), 'kein source_retention_months geschrieben');
}

function scenarioRetentionMonths(): void {
  // --- Unit: Vorrang CLI --months > Env PRUNE_RETENTION_MONTHS > Default 2 ---
  const prevEnv = process.env.PRUNE_RETENTION_MONTHS;
  try {
    delete process.env.PRUNE_RETENTION_MONTHS;
    assertEqual(resolveRetentionMonths(), 2, 'Default-Retention ist 2 Monate');
    assertEqual(resolveRetentionMonths({ months: 1 }), 1, '--months überschreibt Default');
    process.env.PRUNE_RETENTION_MONTHS = '3';
    assertEqual(resolveRetentionMonths(), 3, 'Env wird gelesen');
    assertEqual(resolveRetentionMonths({ months: 2 }), 2, '--months schlägt Env');
    process.env.PRUNE_RETENTION_MONTHS = 'nope';
    let threw = false;
    try {
      resolveRetentionMonths();
    } catch {
      threw = true;
    }
    assert(threw, 'ungültige Env wird abgelehnt');
    delete process.env.PRUNE_RETENTION_MONTHS;

    // --- Unit: Cutoff-Formel (lokal, 1. des Monats) ---
    const now = Date.now();
    const d = new Date(now);
    const c1 = resolveCutoffMs({ months: 1 }, now);
    const c2 = resolveCutoffMs({ months: 2 }, now);
    assertEqual(c1, new Date(d.getFullYear(), d.getMonth(), 1).getTime(), 'cutoff(m1) = 1. des aktuellen Monats');
    assertEqual(c2, new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), 'cutoff(m2) = 1. des Vormonats');

    // --- Verhalten: Fixture mit Vor-/aktuellem Monat ---
    const makeRetentionFixture = (tag: string) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `opencode-prune-${tag}-`));
      tempRoots.push(root);
      const n = Date.now();
      const cutoff1 = resolveCutoffMs({ months: 1 }, n); // 1. des aktuellen Monats
      const cutoff2 = resolveCutoffMs({ months: 2 }, n); // 1. des Vormonats
      const tOld = cutoff2 - 30 * DAY; // älter als Vormonatsbeginn
      const tPrev = cutoff1 - 5 * DAY; // Vormonat (immer nach cutoff2)
      const tCurr = Math.max(n, cutoff1 + 2 * DAY); // aktueller Monat, unique neueste Zeit
      const sourceDb = path.join(root, 'opencode.db');
      const db = createSourceDb(sourceDb);
      try {
        insertSessions(db, [{ id: 's1', projectId: 'p1', directory: '/fixture/ret', time: tOld }]);
        insertMessages(db, [
          { id: 'm-ret-old', sessionId: 's1', type: 'assistant', time: tOld, input: 100, output: 10, reasoning: 5, cacheRead: 200, cacheWrite: 30, cost: 0.001 },
          { id: 'm-ret-prev', sessionId: 's1', type: 'assistant', time: tPrev, input: 110, output: 11, reasoning: 6, cacheRead: 210, cacheWrite: 31, cost: 0.002 },
          { id: 'm-ret-curr', sessionId: 's1', type: 'assistant', time: tCurr, input: 120, output: 12, reasoning: 7, cacheRead: 220, cacheWrite: 32, cost: 0.003 },
        ]);
      } finally {
        db.close();
      }
      return {
        sourceDb,
        statsDb: path.join(root, 'stats.db'),
        backupPath: path.join(root, 'opencode-backup-test.db'),
        cutoff1,
        cutoff2,
        tOld,
        tPrev,
        tCurr,
      };
    };

    // retention 1 (per --months): Vormonat wird schon gelöscht.
    const f1 = makeRetentionFixture('ret1');
    sync({ full: true, sourceDb: f1.sourceDb, analysisDb: f1.statsDb });
    const r1 = pruneSource({
      yes: true,
      cutoffMs: f1.cutoff1,
      retentionMonths: 1,
      sourceDb: f1.sourceDb,
      analysisDb: f1.statsDb,
      backupPath: f1.backupPath,
    });
    assertEqual(r1.deleted, 2, 'retention 1: Vormonat + älter werden gelöscht');
    assertEqual(r1.cutoffMs, f1.cutoff1, 'retention 1: Cutoff = 1. des aktuellen Monats');
    assertEqual(
      withRo(f1.sourceDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM session_message')),
      1,
      'retention 1: nur die aktuelle Message bleibt',
    );
    assertEqual(readMetaMap(f1.statsDb).source_retention_months, '1', 'meta: source_retention_months = 1');
    assertEqual(readMetaMap(f1.statsDb).source_pruned_until, String(f1.cutoff1), 'meta: source_pruned_until = cutoff1');

    // retention 2 (Default): Vormonat bleibt.
    const f2 = makeRetentionFixture('ret2');
    sync({ full: true, sourceDb: f2.sourceDb, analysisDb: f2.statsDb });
    const r2 = pruneSource({
      yes: true,
      cutoffMs: f2.cutoff2,
      retentionMonths: 2,
      sourceDb: f2.sourceDb,
      analysisDb: f2.statsDb,
      backupPath: f2.backupPath,
    });
    assertEqual(r2.deleted, 1, 'retention 2: nur älter als Vormonatsbeginn wird gelöscht');
    assertEqual(r2.cutoffMs, f2.cutoff2, 'retention 2: Cutoff = 1. des Vormonats');
    assertEqual(
      withRo(f2.sourceDb, (db) => countRows(db, 'SELECT COUNT(*) AS n FROM session_message')),
      2,
      'retention 2: Vormonat + aktueller Monat bleiben',
    );
    assertEqual(readMetaMap(f2.statsDb).source_retention_months, '2', 'meta: source_retention_months = 2');
  } finally {
    if (prevEnv === undefined) delete process.env.PRUNE_RETENTION_MONTHS;
    else process.env.PRUNE_RETENTION_MONTHS = prevEnv;
  }
}

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
function cleanup(): void {
  for (const root of tempRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort — Temp-Verzeichnisse werden vom OS ohnehin geräumt
    }
  }
  tempRoots.length = 0;
}

const scenarios: Array<[string, () => void]> = [
  ['1 Determinismus (Prune unsichtbar für Aggregate)', scenarioDeterminism],
  ['2 Monats-Simulation (Quelle gekürzt, stats.db vollständig)', scenarioMonthSimulation],
  ['3 Live-Verkehr nach Prune (ALT+NEU korrekt)', scenarioLiveTraffic],
  ['4 Idempotenz (2. Lauf löscht 0, kein neues Backup)', scenarioIdempotency],
  ['5 Full-Guard (verweigert ohne --force, läuft mit)', scenarioFullGuard],
  ['6 Preflight-Mismatch (Abbruch, Quelle unangetastet)', scenarioPreflightMismatch],
  ['7 Dry-Run-Default (nichts geschrieben)', scenarioDryRun],
  ['8 Retention 1 vs 2 (Kalendermonate, Default 2)', scenarioRetentionMonths],
];

let passed = 0;
const failures: string[] = [];
for (const [name, fn] of scenarios) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}: ${msg}`);
    console.error(`  FAIL ${name}\n       ${msg}`);
  }
}
cleanup();
console.log(`PASS ${passed}/${scenarios.length}`);
if (failures.length > 0) {
  console.error('Fehlgeschlagene Szenarien:');
  for (const fl of failures) console.error(`  - ${fl}`);
  process.exit(1);
}
