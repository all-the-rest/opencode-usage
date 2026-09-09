/**
 * Watch mode: polls the mtime of opencode.db and opencode.db-wal every 2s and
 * runs the same incremental sync (scripts/extract.ts -> sync()) when either
 * changes. After every successful sync, maybePrune() runs the Quell-DB-Retention
 * (scripts/prune-source.ts) — prune errors never stop the loop. Clean shutdown
 * on SIGINT/SIGTERM.
 */

import fs from 'node:fs';
import { localDay, sync, SOURCE_DB } from './extract';
import {
  countPrunableRows,
  pruneSource,
  resolveCutoffMs,
  resolveRetentionMonths,
} from './prune-source';

const POLL_MS = 2000;

let running = false;
let stop = false;

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

let lastDb = mtime(SOURCE_DB);
let lastWal = mtime(SOURCE_DB + '-wal');

function tick(): void {
  if (stop) return;
  const db = mtime(SOURCE_DB);
  const wal = mtime(SOURCE_DB + '-wal');
  if (db === lastDb && wal === lastWal) return; // no change
  lastDb = db;
  lastWal = wal;
  if (running) return; // a sync is already in flight; next tick will catch up
  running = true;
  try {
    const res = sync();
    console.log(
      `[watch] change detected — synced ${res.newMessages} new message(s) in ${res.durationMs} ms`,
    );
    // Der Sync war erfolgreich → jetzt darf die Retention laufen (Invariante:
    // erst sync, dann prune).
    maybePrune();
  } catch (e) {
    console.error('[watch] sync error:', e);
  } finally {
    running = false;
  }
}

// --- Quell-DB-Retention (maybePrune) ----------------------------------------
// Gate: höchstens ein ERFOLGREICHER Prune pro Tag (Datum-Compare in dieser
// Modul-Variable). Der COUNT=0-Vorcheck auf der Quelle (read-only, Index auf
// time_created) macht tägliche Läufe billig: bei 0 gibt es kein Archiv und
// keine meta-Writes, der Tag gilt als erledigt. Bei einem Fehler wird der Tag
// NICHT markiert → nächster Versuch beim nächsten Sync; der Watch-Loop endet
// nie an einem Prune-Fehler.
let pruneDoneDay = '';

function maybePrune(): void {
  const today = localDay(Date.now());
  if (today === pruneDoneDay) return;
  try {
    // Retention in Kalendermonaten: Env PRUNE_RETENTION_MONTHS, Default 1
    // (= Cutoff 1. des aktuellen Monats).
    const retentionMonths = resolveRetentionMonths();
    const cutoffMs = resolveCutoffMs({ months: retentionMonths });
    if (countPrunableRows(SOURCE_DB, cutoffMs) === 0) {
      pruneDoneDay = today;
      return;
    }
    // tick() hat sync() VOR diesem Aufruf bereits erfolgreich ausgeführt,
    // deshalb syncFirst: false (Reihenfolge sync → prune ist die Invariante).
    const res = pruneSource({ yes: true, syncFirst: false, cutoffMs, retentionMonths });
    pruneDoneDay = today;
    if (res.deleted > 0) {
      console.log(
        `[watch] prune: ${res.deleted} message(s) vor ${localDay(res.cutoffMs)} gelöscht ` +
          `(retention ${retentionMonths} Monat(e), Archiv: ${res.archivePath ?? 'keins'})`,
      );
    } else {
      console.log('[watch] prune: nichts gelöscht (Kandidaten zwischenzeitlich verschwunden)');
    }
  } catch (e) {
    console.error('[watch] prune error (retry after next sync):', e);
  }
}

function loop(): void {
  const timer = setInterval(() => {
    if (stop) {
      clearInterval(timer);
      return;
    }
    tick();
  }, POLL_MS);
}

function shutdown(signal: string): void {
  if (stop) return;
  stop = true;
  console.log(`\n[watch] received ${signal} — shutting down (waiting for in-flight sync)`);
  // Give a brief grace period for any in-flight sync to finish, then exit.
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`[watch] polling ${SOURCE_DB} every ${POLL_MS}ms (Ctrl+C to stop)`);
// Initial sync on launch: catches up everything that accumulated while the
// watch was down (e.g. overnight). Without this, dev.command would show stale
// data until the NEXT source change — the dashboard would miss today.
try {
  const res = sync();
  console.log(
    `[watch] initial sync — ${res.newMessages} new message(s) in ${res.durationMs} ms`,
  );
  lastDb = mtime(SOURCE_DB);
  lastWal = mtime(SOURCE_DB + '-wal');
  maybePrune();
} catch (e) {
  console.error('[watch] initial sync error:', e);
}
loop();
