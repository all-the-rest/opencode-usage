/**
 * Quell-DB-Retention: löscht alte session_message-Zeilen aus der OpenCode-Quell-DB,
 * NACHDEM stats.db sie vollständig übernommen hat. Invariante: stats.db ist eine
 * Obermenge von allem, was aus der Quelle gelöscht wird — die Reihenfolge ist
 * immer sync → Preflight-Check → Archiv → löschen.
 *
 * Retention: konfigurierbar in Kalendermonaten, Default 2. Cutoff = lokaler 1.
 * des Monats, (retentionMonths − 1) Monate zurück — Default also der 1. des
 * AKTUELLEN Monats (im September wird alles vor dem 1.9. gelöscht). Vorrang:
 * --cutoff YYYY-MM-DD / --days N > --months N > Env PRUNE_RETENTION_MONTHS > 2.
 * session_v2 (Sessions) bleibt in V1 unberührt (alte Sessions existieren leer
 * weiter; Session-Pruning ist V2).
 *
 * AUSNAHME (bewusst, die einzige im Projekt): für den DELETE wird die Quell-DB
 * mit Lese-Schreib-Zugriff geöffnet (`new Database(sourceDb, { fileMustExist:
 * true })`). Überall sonst gilt strikt read-only ({ readonly: true }, siehe
 * extract.ts / server/db.ts). Sync und Preflight laufen auf read-only
 * Connections; das Delta-Archiv schreibt ausschließlich die Archiv-Datei.
 *
 * CLI: pnpm prune-source [--yes] [--cutoff YYYY-MM-DD] [--days N] [--months N]
 *                       [--vacuum] [--force]
 * Ohne --yes läuft ein Dry-Run: es wird ausschließlich gemeldet, nichts
 * geschrieben, kein Archiv, keine meta-Änderung. --vacuum macht nach dem
 * Löschen ein VACUUM der Quelle (OpenCode muss dafür geschlossen sein) — im
 * automatisierten Watch-Pfad nie aktiv. --force ist hier rein informativ
 * (zeigt den source_pruned_until-Stand; der zugehörige --full-Guard lebt in
 * scripts/extract.ts).
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANALYSIS_DB, SOURCE_DB, sync } from './extract';

export const DEFAULT_RETENTION_MONTHS = 2;

// ---------------------------------------------------------------------------
// cutoff / retention helpers
// ---------------------------------------------------------------------------
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Retention in Kalendermonaten. Vorrang: opts.months (CLI --months) >
 * Env PRUNE_RETENTION_MONTHS > Default 2. Ungültige Werte werden abgelehnt.
 */
export function resolveRetentionMonths(opts: { months?: number } = {}): number {
  let months = opts.months;
  if (months == null) {
    const raw = process.env.PRUNE_RETENTION_MONTHS;
    if (raw != null && raw !== '') {
      const env = Number(raw);
      if (!Number.isInteger(env) || env < 1) {
        throw new Error(
          `[prune] PRUNE_RETENTION_MONTHS="${raw}" ist ungültig — ganzzahlig >= 1 (Kalendermonate) erwartet.`,
        );
      }
      months = env;
    }
  }
  if (months == null) return DEFAULT_RETENTION_MONTHS;
  if (!Number.isInteger(months) || months < 1) {
    throw new Error(
      `[prune] Retention ${months} ist ungültig — ganzzahlig >= 1 (Kalendermonate) erwartet.`,
    );
  }
  return months;
}

export interface CutoffOptions {
  /** Expliziter Cutoff als lokales Datum YYYY-MM-DD (höchster Vorrang). */
  cutoffDate?: string;
  /** Cutoff = jetzt minus N Tage. */
  days?: number;
  /** Retention in Kalendermonaten (Default 2 → 1. des Vormonats). */
  months?: number;
}

/** Cutoff als ms-Epoch. Vorrang: cutoffDate > days > months. */
export function resolveCutoffMs(opts: CutoffOptions = {}, now = Date.now()): number {
  if (opts.cutoffDate != null) return localMidnightMs(opts.cutoffDate);
  if (opts.days != null) {
    if (!Number.isInteger(opts.days) || opts.days < 0) {
      throw new Error(`[prune] --days ${opts.days} ist ungültig — ganzzahlig >= 0 erwartet.`);
    }
    return now - opts.days * 24 * 60 * 60 * 1000;
  }
  const months = resolveRetentionMonths(opts);
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() - (months - 1), 1).getTime();
}

/** YYYY-MM-DD (lokal) → ms-Epoch Mitternacht; validiert das Datum. */
function localMidnightMs(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`[prune] --cutoff "${date}" ist ungültig — Format YYYY-MM-DD erwartet.`);
  }
  const ms = new Date(date + 'T00:00:00').getTime();
  const d = new Date(ms);
  // Roundtrip-Check (sonst würde z. B. 2026-02-31 still nach 2026-03-03 rollen)
  if (
    !Number.isFinite(ms) ||
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` !== date
  ) {
    throw new Error(`[prune] --cutoff "${date}" ist kein gültiges Datum.`);
  }
  return ms;
}

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYYMM (lokal) — für Delta-Archiv-Namen je gelöschtem Monat. */
function yyyymm(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return `${n} B`;
}

// ---------------------------------------------------------------------------
// meta helpers (stats.db)
// ---------------------------------------------------------------------------
function getMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

// ---------------------------------------------------------------------------
// read-only helpers on the source DB
// ---------------------------------------------------------------------------
function openSourceRo(sourceDb: string): Database.Database {
  return new Database(sourceDb, { fileMustExist: true, readonly: true });
}

/** Anzahl session_message-Zeilen vor dem Cutoff (read-only; Watch-Gate-Vorcheck). */
export function countPrunableRows(sourceDb: string, cutoffMs: number): number {
  const ro = openSourceRo(sourceDb);
  try {
    const row = ro
      .prepare('SELECT COUNT(*) AS n FROM session_message WHERE time_created < ?')
      .get(cutoffMs) as { n: number };
    return row.n;
  } finally {
    ro.close();
  }
}

interface CandidateRow {
  n: number;
  oldest: number | null;
  newest: number | null;
  bytes: number | null;
  oldest_remaining: number | null;
}

function readCandidates(ro: Database.Database, cutoffMs: number): CandidateRow {
  return ro
    .prepare(
      `SELECT COUNT(*) AS n,
              MIN(time_created) AS oldest,
              MAX(time_created) AS newest,
              SUM(LENGTH(data)) AS bytes,
              (SELECT MIN(time_created) FROM session_message WHERE time_created >= ?) AS oldest_remaining
       FROM session_message WHERE time_created < ?`,
    )
    .get(cutoffMs, cutoffMs) as CandidateRow;
}

// ---------------------------------------------------------------------------
// preflight: source vs stats.db for the delete range
// ---------------------------------------------------------------------------
export interface PruneSums {
  n: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

function toSums(r: Record<string, number | null>): PruneSums {
  return {
    n: r.n ?? 0,
    input: r.input ?? 0,
    output: r.output ?? 0,
    reasoning: r.reasoning ?? 0,
    cacheRead: r.cacheRead ?? 0,
    cacheWrite: r.cacheWrite ?? 0,
    cost: r.cost ?? 0,
  };
}

/** Quelle-Seite: Filter exakt wie der Extractor (type='assistant', tokens vorhanden). */
function readSourceSums(ro: Database.Database, cutoffMs: number): PruneSums {
  return toSums(
    ro
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(json_extract(data, '$.tokens.input')) AS input,
                SUM(json_extract(data, '$.tokens.output')) AS output,
                SUM(json_extract(data, '$.tokens.reasoning')) AS reasoning,
                SUM(json_extract(data, '$.tokens.cache.read')) AS cacheRead,
                SUM(json_extract(data, '$.tokens.cache.write')) AS cacheWrite,
                SUM(json_extract(data, '$.cost')) AS cost
         FROM session_message
         WHERE time_created < ?
           AND type = 'assistant'
           AND json_extract(data, '$.tokens') IS NOT NULL`,
      )
      .get(cutoffMs) as Record<string, number | null>,
  );
}

function readStatsSums(analysis: Database.Database, cutoffMs: number): PruneSums {
  return toSums(
    analysis
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(tokens_input) AS input,
                SUM(tokens_output) AS output,
                SUM(tokens_reasoning) AS reasoning,
                SUM(cache_read) AS cacheRead,
                SUM(cache_write) AS cacheWrite,
                SUM(cost) AS cost
         FROM messages WHERE time_created < ?`,
      )
      .get(cutoffMs) as Record<string, number | null>,
  );
}

/**
 * stats.db muss eine Obermenge der Quelle sein (Gleichheit oder mehr). cost ist
 * REAL — die Summenreihenfolge darf minimal abweichen (relative Toleranz);
 * Token-Zähler sind Ganzzahlen und werden exakt verglichen.
 */
function compareSums(src: PruneSums, st: PruneSums): string[] {
  const problems: string[] = [];
  if (st.n < src.n) {
    problems.push(
      `stats.db hat weniger Messages im Löschbereich als die Quelle (${st.n} < ${src.n})`,
    );
  }
  const fields: Array<[keyof PruneSums, string]> = [
    ['input', 'tokens_input'],
    ['output', 'tokens_output'],
    ['reasoning', 'tokens_reasoning'],
    ['cacheRead', 'cache_read'],
    ['cacheWrite', 'cache_write'],
    ['cost', 'cost'],
  ];
  for (const [key, label] of fields) {
    const a = src[key];
    const b = st[key];
    const eps = key === 'cost' ? Math.max(1e-6, Math.abs(a) * 1e-9) : 0;
    if (b < a - eps) {
      problems.push(`stats.db-Summe ${label} ist kleiner als in der Quelle (${b} < ${a})`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// write path (the one deliberate read-write exception)
// ---------------------------------------------------------------------------
/**
 * Delta-Archiv + DELETE in EINER Transaktion (SQLite committet main + ATTACHed
 * DB atomar) + wal_checkpoint(TRUNCATE) danach. Öffnet die Quell-DB mit
 * Lese-Schreib-Zugriff — die eine bewusste Ausnahme (siehe Header-Kommentar).
 * busy_timeout >= 10s für parallele OpenCode-Zugriffe.
 *
 * Archiv statt Vollkopie: nur die zu löschenden Zeilen (inkl. Roh-JSON) wandern
 * per INSERT INTO … SELECT in ein kleines Archiv-DB — bei 70k+ Riesen-Zeilen
 * memory-sicher (kein JavaScript-Row-Transfer) und das Platzbudget bleibt
 * positiv (Vollkopie war 5,4 GB pro Lauf).
 */
function deleteCandidates(
  sourceDb: string,
  cutoffMs: number,
  archivePath: string | null,
): number {
  const rw = new Database(sourceDb, { fileMustExist: true });
  try {
    rw.pragma('busy_timeout = 15000');
    if (archivePath != null) {
      // ATTACH vor der Transaktion (innerhalb einer ist ATTACH verboten).
      // Die Archiv-Datei wurde vorher frisch angelegt/gelöscht.
      rw.exec(`ATTACH DATABASE '${archivePath.replace(/'/g, "''")}' AS archive`);
      try {
        rw.exec(`CREATE TABLE archive.session_message (
          id text PRIMARY KEY,
          session_id text NOT NULL,
          type text NOT NULL,
          seq integer NOT NULL,
          time_created integer NOT NULL,
          time_updated integer NOT NULL,
          data text NOT NULL
        )`);
        const run = rw.transaction(() => {
          rw.prepare(
            `INSERT INTO archive.session_message
               (id, session_id, type, seq, time_created, time_updated, data)
             SELECT id, session_id, type, seq, time_created, time_updated, data
             FROM main.session_message WHERE time_created < ?`,
          ).run(cutoffMs);
          const info = rw
            .prepare('DELETE FROM main.session_message WHERE time_created < ?')
            .run(cutoffMs);
          return Number(info.changes);
        });
        const deleted = run();
        rw.pragma('wal_checkpoint(TRUNCATE)');
        return deleted;
      } finally {
        try {
          rw.exec('DETACH DATABASE archive');
        } catch {
          // Detach-Fehler darf den Erfolg nicht überschreiben (Transaktion ist
          // längst committet); die Archiv-Datei ist geschlossen beim close().
        }
      }
    }
    // ohne Archiv: nur löschen
    const run = rw.transaction(() => {
      const info = rw.prepare('DELETE FROM session_message WHERE time_created < ?').run(cutoffMs);
      return Number(info.changes);
    });
    const deleted = run();
    rw.pragma('wal_checkpoint(TRUNCATE)');
    return deleted;
  } finally {
    rw.close();
  }
}

/** VACUUM der Quelle (nur --vacuum; braucht exklusiven Zugriff). */
function vacuumSource(sourceDb: string): void {
  const rw = new Database(sourceDb, { fileMustExist: true });
  try {
    rw.pragma('busy_timeout = 15000');
    rw.exec('VACUUM');
  } finally {
    rw.close();
  }
}

// ---------------------------------------------------------------------------
// pruneSource
// ---------------------------------------------------------------------------
export interface PrunePreflight {
  source: PruneSums;
  stats: PruneSums;
  ok: boolean;
  problems: string[];
}

export interface PruneResult {
  dryRun: boolean;
  sourceDb: string;
  analysisDb: string;
  cutoffMs: number;
  retentionMonths: number;
  /** Kandidaten (time_created < cutoff) zum Zeitpunkt des Checks. */
  candidates: number;
  oldestCandidate: number | null;
  newestCandidate: number | null;
  bytes: number | null;
  oldestRemaining: number | null;
  /** Tatsächlich gelöscht (0 im Dry-Run bzw. wenn nichts zu tun war). */
  deleted: number;
  archivePath: string | null;
  preflight: PrunePreflight | null;
  metaUpdated: boolean;
  vacuumed: boolean;
}

export interface PruneOptions {
  /** false (Default) = Dry-Run: nur melden, nichts schreiben. */
  yes?: boolean;
  /** Cutoff in ms; Default: lokale Retention-Regel (resolveCutoffMs). */
  cutoffMs?: number;
  /** Retention nur für die meta-Buchhaltung; Default: resolveRetentionMonths(). */
  retentionMonths?: number;
  /** VACUUM der Quelle NACH dem Löschen (OpenCode muss geschlossen sein). */
  vacuum?: boolean;
  /** Pfade nur für Tests gegen Fixtures; Default: SOURCE_DB / ANALYSIS_DB. */
  sourceDb?: string;
  analysisDb?: string;
  /** Delta-Archiv-Ziel; Default: opencode-prune-archive-YYYYMM.db (Cutoff-Monat) neben der Quelle. */
  archivePath?: string;
  /** sync() vorher ausführen (Default true); watch setzt false (tick() hat schon synced). */
  syncFirst?: boolean;
}

export function pruneSource(opts: PruneOptions = {}): PruneResult {
  const sourceDb = opts.sourceDb ?? SOURCE_DB;
  const analysisDb = opts.analysisDb ?? ANALYSIS_DB;
  const yes = opts.yes === true;
  const now = Date.now();
  const cutoffMs = opts.cutoffMs ?? resolveCutoffMs({ months: opts.retentionMonths }, now);
  if (!Number.isFinite(cutoffMs)) {
    throw new Error(`[prune] Ungültiger Cutoff: ${String(cutoffMs)}`);
  }
  if (cutoffMs > now) {
    throw new Error(`[prune] Cutoff liegt in der Zukunft (${localDate(cutoffMs)}) — abgelehnt.`);
  }
  const retentionMonths = resolveRetentionMonths({ months: opts.retentionMonths });

  // Sync-Zwang: vor dem Löschen IMMER (inkrementell) synchronisieren — nur nach
  // erfolgreichem Sync ist stats.db garantiert Obermenge des Löschbereichs.
  if (opts.syncFirst !== false) {
    const res = sync({ sourceDb, analysisDb });
    console.log(`[prune] sync: ${res.newMessages} new message(s) in ${res.durationMs} ms`);
  }

  const ro = openSourceRo(sourceDb);
  try {
    const cand = readCandidates(ro, cutoffMs);
    const result: PruneResult = {
      dryRun: !yes,
      sourceDb,
      analysisDb,
      cutoffMs,
      retentionMonths,
      candidates: cand.n,
      oldestCandidate: cand.oldest,
      newestCandidate: cand.newest,
      bytes: cand.bytes,
      oldestRemaining: cand.oldest_remaining,
      deleted: 0,
      archivePath: null,
      preflight: null,
      metaUpdated: false,
      vacuumed: false,
    };

    if (cand.n === 0) {
      console.log(
        `[prune] nichts zu tun: keine session_message-Zeilen vor ${localDate(cutoffMs)} ` +
          `(retention ${retentionMonths} Kalendermonat(e)).`,
      );
      return result;
    }

    if (!yes) {
      // Dry-Run: ausschließlich melden — kein Archiv, keine meta-Änderung.
      console.log(
        '[prune] DRY-RUN — es wird NICHTS geschrieben (zum Löschen mit --yes ausführen).',
      );
      console.log(`[prune] Quelle: ${sourceDb}`);
      console.log(
        `[prune] Cutoff: ${localDate(cutoffMs)} (retention ${retentionMonths} Kalendermonat(e)) — ` +
          'alles davor würde gelöscht.',
      );
      console.log(
        `[prune] Zu löschen: ${cand.n} session_message-Zeilen ` +
          `(${localDate(cand.oldest ?? 0)} – ${localDate(cand.newest ?? 0)}), ` +
          `~${fmtBytes(cand.bytes ?? 0)} in data.`,
      );
      console.log(
        `[prune] Älteste verbleibende Message danach: ` +
          `${cand.oldest_remaining != null ? localDate(cand.oldest_remaining) : '—'}`,
      );
      // Read-only Vorab-Preflight: warnt früh, wenn ein --yes-Lauf abbrechen würde.
      const analysisRo = new Database(analysisDb, { fileMustExist: true, readonly: true });
      try {
        const src = readSourceSums(ro, cutoffMs);
        const st = readStatsSums(analysisRo, cutoffMs);
        const problems = compareSums(src, st);
        result.preflight = { source: src, stats: st, ok: problems.length === 0, problems };
        if (problems.length === 0) {
          console.log(`[prune] Preflight: ok (Quelle n=${src.n} vs stats.db n=${st.n})`);
        } else {
          console.warn('[prune] Preflight-MISMATCH — ein --yes-Lauf würde ABRECHEN:');
          for (const p of problems) console.warn(`[prune]   - ${p}`);
          console.warn('[prune]   Erst sync laufen lassen (pnpm sync) und Dashboard prüfen.');
        }
      } finally {
        analysisRo.close();
      }
      return result;
    }

    // --- yes-Pfad: preflight → Archiv → delete → meta (→ vacuum) ---
    const analysis = new Database(analysisDb, { fileMustExist: true });
    try {
      const src = readSourceSums(ro, cutoffMs);
      const st = readStatsSums(analysis, cutoffMs);
      const problems = compareSums(src, st);
      result.preflight = { source: src, stats: st, ok: problems.length === 0, problems };
      if (problems.length > 0) {
        throw new Error(
          `[prune] Preflight-Mismatch — stats.db deckt den Löschbereich nicht ab, ` +
            `es wird NICHTS gelöscht:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
            'Erst sync laufen lassen (pnpm sync) und Dashboard prüfen; ohne sauberen Stand ' +
            'wird die Quelle nie gekürzt.',
        );
      }

      // Delta-Archiv (statt Vollkopie): nur die zu löschenden Zeilen inkl.
      // Roh-JSON, je gelöschtem Monat eine kleine Datei — mehrere Monate dürfen
      // kumulieren. Gleichnamiges Archiv wird ersetzt (Re-Lauf).
      const archivePath =
        opts.archivePath ??
        path.join(path.dirname(sourceDb), `opencode-prune-archive-${yyyymm(cutoffMs)}.db`);
      const archiveDir = path.dirname(archivePath);
      fs.mkdirSync(archiveDir, { recursive: true });
      if (fs.existsSync(archivePath)) fs.rmSync(archivePath, { force: true });
      console.log(
        `[prune] Archiv: ${cand.n} Zeile(n) (~${fmtBytes(cand.bytes ?? 0)}) → ${archivePath} …`,
      );
      try {
        // Datei anlegen, damit ATTACH die leere DB nicht implizit erzeugt,
        // falls der Pfad schon wieder weg ist (Race mit Rotation/Cleanup).
        if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, '');
      } catch (e) {
        throw new Error(
          `[prune] Archiv-Datei nicht anlegbar (${e instanceof Error ? e.message : String(e)}) — ` +
            'ABBRUCH, es wurde NICHTS gelöscht.',
        );
      }

      const deleted = deleteCandidates(sourceDb, cutoffMs, archivePath);
      result.deleted = deleted;
      result.archivePath = archivePath;
      console.log(
        `[prune] Archiv ok: ${archivePath} (${fmtBytes(fs.statSync(archivePath).size)})`,
      );
      console.log(`[prune] gelöscht: ${deleted} session_message-Zeilen vor ${localDate(cutoffMs)}.`);

      // Buchhaltung in stats.db meta. source_pruned_count ist KUMULATIV über
      // alle Läufe (Summe der tatsächlich gelöschten Zeilen);
      // source_pruned_until / source_pruned_at / source_retention_months sind
      // der Stand des letzten Laufs.
      const prevCount = Number(getMeta(analysis, 'source_pruned_count') ?? '0');
      analysis.transaction(() => {
        setMeta(analysis, 'source_pruned_until', String(cutoffMs));
        setMeta(analysis, 'source_pruned_at', String(now));
        setMeta(
          analysis,
          'source_pruned_count',
          String((Number.isFinite(prevCount) ? prevCount : 0) + deleted),
        );
        setMeta(analysis, 'source_retention_months', String(retentionMonths));
        setMeta(analysis, 'source_archive_path', archivePath);
      })();
      result.metaUpdated = true;

      // VACUUM nur manuell (--vacuum): braucht exklusiven Zugriff — OpenCode
      // muss geschlossen sein. Im Automatik-Pfad nie aktiv.
      if (opts.vacuum === true) {
        try {
          vacuumSource(sourceDb);
          result.vacuumed = true;
          console.log('[prune] VACUUM der Quelle abgeschlossen.');
        } catch (e) {
          console.warn(
            `[prune] VACUUM fehlgeschlagen (OpenCode läuft evtl. noch?): ` +
              `${e instanceof Error ? e.message : String(e)} — die gelöschten Zeilen sind trotzdem weg.`,
          );
        }
      } else {
        console.log(
          '[prune] Hinweis: Plattenplatz wird erst mit VACUUM freigegeben — `pnpm prune-source --yes --vacuum` (OpenCode geschlossen).',
        );
      }
      return result;
    } finally {
      analysis.close();
    }
  } finally {
    ro.close();
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
function usage(): string {
  return `pnpm prune-source [Optionen]

Quell-DB-Retention: löscht session_message-Zeilen, die älter als der Cutoff
sind, wenn stats.db sie vollständig übernommen hat
(sync → preflight → Archiv → löschen). Sessions (session_v2) bleiben vorerst
unberührt.

  --yes                wirklich löschen (ohne --yes: Dry-Run, nur melden)
  --cutoff YYYY-MM-DD  expliziter Cutoff, lokales Datum (überschreibt --months)
  --days N             Cutoff = jetzt minus N Tage (überschreibt --months)
  --months N           Retention in Kalendermonaten, Default 2 → Cutoff = 1. des
                       Vormonats (1 → 1. des aktuellen Monats). Vorrang:
                       --months > Env PRUNE_RETENTION_MONTHS > Default 2
  --vacuum             VACUUM der Quelle NACH dem Löschen — OpenCode muss dafür
                       geschlossen sein
  --force              rein informativ: zeigt den source_pruned_until-Stand
                       (der --full-Guard lebt in scripts/extract.ts)
  -h, --help           diese Hilfe`;
}

function main(argv: string[]): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }
  let yes = false;
  let vacuum = false;
  let force = false;
  let cutoffDate: string | undefined;
  let days: number | undefined;
  let months: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a == null) continue;
    const next = (): string => {
      const v = argv[i + 1];
      i += 1;
      if (v == null || v === '') throw new Error(`[prune] ${a} braucht einen Wert.`);
      return v;
    };
    switch (a) {
      case '--yes':
        yes = true;
        break;
      case '--vacuum':
        vacuum = true;
        break;
      case '--force':
        force = true;
        break;
      case '--cutoff':
        cutoffDate = next();
        break;
      case '--days': {
        const v = Number(next());
        if (!Number.isInteger(v) || v < 0) {
          throw new Error('[prune] --days braucht eine ganze Zahl >= 0.');
        }
        days = v;
        break;
      }
      case '--months': {
        const v = Number(next());
        if (!Number.isInteger(v) || v < 1) {
          throw new Error('[prune] --months braucht eine ganze Zahl >= 1 (Kalendermonate).');
        }
        months = v;
        break;
      }
      default:
        throw new Error(`[prune] Unbekanntes Argument: ${a} (--help für Hilfe)`);
    }
  }

  if (force) {
    // Rein informativ (siehe usage) — der --full-Guard liest denselben Key.
    try {
      const ro = new Database(ANALYSIS_DB, { fileMustExist: true, readonly: true });
      try {
        const until = getMeta(ro, 'source_pruned_until');
        const at = getMeta(ro, 'source_pruned_at');
        const count = getMeta(ro, 'source_pruned_count');
        const retention = getMeta(ro, 'source_retention_months');
        const parts: string[] = [];
        if (until != null) parts.push(`bis ${localDate(Number(until))}`);
        if (at != null) parts.push(`letzter Lauf ${localDate(Number(at))}`);
        if (count != null) parts.push(`kumulativ ${count} Zeile(n)`);
        if (retention != null) parts.push(`retention ${retention} Monat(e)`);
        console.log(
          `[prune] source_pruned_until: ${until != null ? parts.join(', ') : '— (noch nie geprunt)'}`,
        );
      } finally {
        ro.close();
      }
    } catch (e) {
      console.log(
        `[prune] source_pruned_until: — (stats.db nicht lesbar: ${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  const res = pruneSource({
    yes,
    vacuum,
    retentionMonths: months,
    cutoffMs:
      cutoffDate != null || days != null ? resolveCutoffMs({ cutoffDate, days, months }) : undefined,
  });
  if (res.dryRun) {
    console.log('[prune] Dry-Run beendet — nichts geändert.');
  } else if (res.deleted > 0) {
    console.log(`[prune] fertig: ${res.deleted} Zeile(n) gelöscht, Archiv: ${res.archivePath ?? 'keins'}.`);
  } else {
    console.log('[prune] fertig: nichts zu löschen.');
  }
}

const arg1 = process.argv[1];
const isMain = arg1 !== undefined && import.meta.url === pathToFileURL(arg1).href;
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
