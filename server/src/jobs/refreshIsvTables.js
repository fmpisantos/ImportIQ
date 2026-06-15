// Automated yearly refresh of the statutory ISV environmental tables.
//
// Fetches the configured reference pages, validates them against the hardcoded
// baseline (≥2 sources must agree per key, plus structural + cross-fuel sanity
// checks), and writes the validated result into refdata_cache under
// 'isv-tables'. The engine reads that override via engine/isvTableStore.js,
// falling back to the baseline whenever no valid override exists. Rejections are
// logged for human review and never mutate the stored tables. Never throws.

import { getIsvTablesConfig } from '../config.js';
import { fetchIsvTables, validateAndMerge } from '../adapters/isvTablesSource.js';
import { ENVIRONMENTAL_BRACKETS, TABLES_VERSION } from '../engine/isvTables.js';
import { setCached } from '../db.js';
import { clearIsvTableCache, ISV_TABLES_CACHE_KEY } from '../engine/isvTableStore.js';

export async function runRefreshIsvTables({ fetchImpl = fetch, now = Date.now() } = {}) {
  const { sourceUrls } = getIsvTablesConfig();
  if (!sourceUrls.length) {
    console.warn('[isv-refresh] no source URLs configured — skipping');
    return { applied: false, accepted: [], flags: ['no source URLs configured'] };
  }

  const perSource = await fetchIsvTables({ sourceUrls, fetchImpl });
  const { environmental, accepted, changed, flags } = validateAndMerge(perSource, ENVIRONMENTAL_BRACKETS);

  for (const flag of flags) console.warn(`[isv-refresh] ${flag}`);

  if (!changed) {
    console.log(
      `[isv-refresh] no change — fetched tables match the baseline (${accepted.length} key(s) confirmed)`
    );
    return { applied: false, accepted, flags };
  }

  setCached(
    'refdata_cache',
    ISV_TABLES_CACHE_KEY,
    { version: TABLES_VERSION, environmental, source: 'auto-refresh', accepted },
    now
  );
  clearIsvTableCache(); // take effect without a restart
  console.log(`[isv-refresh] applied validated override for: ${accepted.join(', ')}`);
  return { applied: true, accepted, flags };
}
