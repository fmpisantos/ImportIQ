// Runtime resolver for the ISV environmental tables.
//
// The hardcoded brackets in ./isvTables.js are the statutory BASELINE and the
// always-available fallback. The automated yearly refresh job
// (../jobs/refreshIsvTables.js) writes a *validated* override into
// `refdata_cache` under the key 'isv-tables'; this module prefers that override
// when present and structurally sound, and otherwise returns the baseline.
//
// This is the single impure boundary between the pure ISV engine and the config
// store: the engine functions stay deterministic by defaulting to the baseline,
// while production lookups flow through getEnvironmentalBrackets().

import { getCached } from '../db.js';
import { ENVIRONMENTAL_BRACKETS } from './isvTables.js';

export const ISV_TABLES_CACHE_KEY = 'isv-tables';

// Treat an override as usable for up to ~400 days, so a once-a-year refresh
// keeps it warm. If it ever goes staler than that we fall back to the baseline
// (which is itself kept current in source) — never to nothing.
const OVERRIDE_TTL_MS = 400 * 24 * 60 * 60 * 1000;

let memo = null; // { brackets } once resolved this process

// JSON has no Infinity — JSON.stringify(Infinity) yields null. The catch-all
// bracket's `max: Infinity` therefore round-trips through the cache as `max:
// null`, so revive it before the table reaches the engine.
function reviveEnvironmental(env) {
  if (!env || typeof env !== 'object') return env;
  const out = {};
  for (const [key, brackets] of Object.entries(env)) {
    out[key] = Array.isArray(brackets)
      ? brackets.map((b) => (b && b.max === null ? { ...b, max: Infinity } : b))
      : brackets;
  }
  return out;
}

/** Minimal structural guard so a malformed cache row can never reach the engine. */
function looksLikeEnvironmentalTable(env) {
  if (!env || typeof env !== 'object') return false;
  const required = ['gasoline.WLTP', 'gasoline.NEDC', 'diesel.WLTP', 'diesel.NEDC'];
  return required.every((key) => {
    const brackets = env[key];
    if (!Array.isArray(brackets) || brackets.length === 0) return false;
    const last = brackets[brackets.length - 1];
    if (!last || last.max !== Infinity) return false; // catch-all bracket required
    return brackets.every(
      (b) =>
        b &&
        typeof b.ratePerGkm === 'number' &&
        b.ratePerGkm > 0 &&
        typeof b.deduction === 'number'
    );
  });
}

/**
 * Resolve the active environmental-component tables.
 *
 * Order: validated cache override → hardcoded baseline. Memoized for the life of
 * the process; the refresh job calls clearIsvTableCache() after writing so a
 * fresh override takes effect without a restart.
 */
export function getEnvironmentalBrackets() {
  if (memo) return memo.brackets;

  let brackets = ENVIRONMENTAL_BRACKETS;
  try {
    const override = getCached('refdata_cache', ISV_TABLES_CACHE_KEY, OVERRIDE_TTL_MS, Date.now());
    const revived = override && reviveEnvironmental(override.environmental);
    if (revived && looksLikeEnvironmentalTable(revived)) {
      brackets = revived;
    }
  } catch {
    // Any DB hiccup → silently use the baseline. Tax math must never break.
    brackets = ENVIRONMENTAL_BRACKETS;
  }

  memo = { brackets };
  return brackets;
}

/** Drop the memoized tables so the next lookup re-reads the cache. */
export function clearIsvTableCache() {
  memo = null;
}
