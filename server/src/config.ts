/**
 * Runtime configuration, read once from the environment.
 *
 * Defaults are deliberately safe (Specification §3.6, §9): `mock` sources and a
 * disabled scheduler, so a fresh clone runs offline with no credentials and the
 * nightly batch never fires until the user opts in.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export type SourceMode = "mock" | "live";

function envEnum<T extends string>(name: string, allowed: T[], fallback: T): T {
  const v = process.env[name];
  return v && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),

  /** German source mode. `mock` is the default for local dev and tests. */
  sourceMode: envEnum<SourceMode>("SOURCE_MODE", ["mock", "live"], "mock"),
  /** PT comparison source mode. */
  ptSourceMode: envEnum<SourceMode>("PT_SOURCE_MODE", ["mock", "live"], "mock"),

  /** Absolute path to the SQLite store. */
  dbPath: process.env.DB_PATH ?? path.resolve(here, "..", "data", "importiq.db"),

  /** Search-result cache TTL (§8): 3 hours. */
  searchCacheTtlMs: 3 * 60 * 60 * 1000,
  /** PT comparison cache TTL (§8): ~1 day. */
  ptCacheTtlMs: 24 * 60 * 60 * 1000,

  /** Polite pacing between paged source requests (§3.5). */
  sourcePacingMs: Number(process.env.SOURCE_PACING_MS ?? 300),

  /** Nightly scheduler — disabled by default, opt-in (§9). */
  schedulerEnabled: process.env.SCHEDULER_ENABLED === "true",
  /** Cron expression for the nightly batch (default 03:00). */
  schedulerCron: process.env.SCHEDULER_CRON ?? "0 3 * * *",
  /** How many pages deep a batch run goes per source (§9 — deeper than live). */
  batchDepthPages: Number(process.env.BATCH_DEPTH_PAGES ?? 5),
  /** How many top deals to keep per saved batch search. */
  batchTopDeals: Number(process.env.BATCH_TOP_DEALS ?? 20),
} as const;
