/**
 * Read-only SQLite access to the analysis database (data/stats.db).
 *
 * better-sqlite3 v13 does not support the `file:?mode=ro` URI here — we open
 * with `{ fileMustExist: true, readonly: true }` exactly as AGENTS.md requires.
 * All access is strictly read-only; the server never writes to this file.
 */
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

export type DatabaseType = ReturnType<typeof Database>;

const DEFAULT_DB_PATH = fileURLToPath(
  new URL("../data/stats.db", import.meta.url),
);

let dbInstance: DatabaseType | null = null;
let dbError: string | null = null;

/** Absolute path to the stats DB, overridable via STATS_DB (must be absolute). */
export function resolveDbPath(): string {
  return process.env.STATS_DB ?? DEFAULT_DB_PATH;
}

/**
 * Open (and cache) the read-only database connection.
 * Returns `null` when the file is missing or cannot be opened — callers must
 * translate that into a 503 response; the server never crashes on a missing DB.
 * A successful connection is cached; failures are retried on the next call.
 */
export function openDatabase(): DatabaseType | null {
  if (dbInstance) return dbInstance;
  try {
    dbInstance = new Database(resolveDbPath(), {
      fileMustExist: true,
      readonly: true,
    });
    dbError = null;
    return dbInstance;
  } catch (err) {
    dbError =
      err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function getDbError(): string | null {
  return dbError;
}

/** Coerce nullable SQLite sums (NULL when no rows match) to a number. */
export function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Cache-hit ratio = cache_read / (input + cache_read + cache_write).
 * Guards the divide-by-zero case (returns 0 when the denominator is 0).
 */
export function cacheHitRatio(
  input: number,
  cacheRead: number,
  cacheWrite: number,
): number {
  const denom = input + cacheRead + cacheWrite;
  if (denom <= 0) return 0;
  return cacheRead / denom;
}
