/**
 * Watch mode: polls the mtime of opencode.db and opencode.db-wal every 2s and
 * runs the same incremental sync (scripts/extract.ts -> sync()) when either
 * changes. Clean shutdown on SIGINT/SIGTERM.
 */

import fs from 'node:fs';
import { sync, SOURCE_DB } from './extract';

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
  } catch (e) {
    console.error('[watch] sync error:', e);
  } finally {
    running = false;
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
loop();
