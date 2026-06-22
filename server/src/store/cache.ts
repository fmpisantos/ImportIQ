/**
 * TTL cache backed by the SQLite `cache` table (Specification §8).
 *
 * Cache keys MUST include every field that changes the result (all filters +
 * page + source) so two different searches can never collide — see
 * `searchService`/`comparisonService` for the key builders.
 */

import { db } from "./db.js";

const getStmt = db.prepare<[string, number]>(
  "SELECT value FROM cache WHERE key = ? AND expires_at > ?",
);
const setStmt = db.prepare<[string, string, number]>(
  "INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
);
const delStmt = db.prepare<[number]>("DELETE FROM cache WHERE expires_at <= ?");

export function cacheGet<T>(key: string): T | null {
  const row = getStmt.get(key, Date.now()) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : null;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  setStmt.run(key, JSON.stringify(value), Date.now() + ttlMs);
}

/** Fetch-through helper: return the cached value or compute, store, and return. */
export async function cacheThrough<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  cacheSet(key, value, ttlMs);
  return value;
}

/** Drop expired rows (called opportunistically at startup). */
export function pruneCache(): void {
  delStmt.run(Date.now());
}
