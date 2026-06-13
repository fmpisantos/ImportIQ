// Multi-source PT market comparison orchestrator (DATA_SOURCE=direct/apify).
//
// Fans out to every configured keyless PT source (getPtSourcesConfig: OLX.pt +
// Standvirtual), merges their matched comparables, dedupes cross-source
// duplicates, then runs the shared finalize step (IQR trim → robust
// market-value estimate). Each source is independent: one that fails or is
// blocked is skipped (Promise.allSettled) and its zero count is surfaced in
// `sources[]`, so a silently-empty source is visible rather than hidden.
//
// More, less-biased comparables = a more accurate PT benchmark — the core value
// of the product. OLX skews to private sellers (cheaper); Standvirtual skews to
// dealers (closer to what you resell at). Together they bracket the real market.

import { fetchComparables as fetchOlx } from './olxpt.js';
import { fetchComparables as fetchStandvirtual } from './standvirtual.js';
import { comparisonCriteria, finalizeComparison } from '../ptMarketClient.js';
import { getPtSourcesConfig } from '../../config.js';

// Source name → raw-comparable fetcher. Each returns
// { items, searchUrl, criteria, source }.
const SOURCE_FETCHERS = {
  olx: fetchOlx,
  standvirtual: fetchStandvirtual,
};

/** Drop the same car listed twice (across or within sources). URL is the
 *  strongest key; otherwise price+mileage+year+model. */
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const c of items) {
    const key = c.url
      ? `url:${String(c.url).toLowerCase()}`
      : ['k', c.priceEur, c.mileageKm, c.year, String(c.model ?? '').toLowerCase()].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Combined PT comparison for one listing across all configured sources.
 *
 * @param {object} listing  normalised listing (brand/model/year/mileageKm)
 * @param {object} [opts]   { sources?, fetchImpl?, … } — opts pass through to
 *                          each source fetcher (e.g. fetchImpl in tests)
 * @returns {Promise<object>} comparison (finalizeComparison shape) + searchUrl +
 *   sources[] per-source breakdown
 */
export async function getComparisonCombined(listing, opts = {}) {
  const enabled = opts.sources ?? getPtSourcesConfig();
  const fetchers = enabled
    .map((name) => [name, SOURCE_FETCHERS[name]])
    .filter(([, fn]) => typeof fn === 'function');

  const settled = await Promise.allSettled(
    fetchers.map(([, fn]) => fn(listing, opts))
  );

  const perSource = [];
  const merged = [];
  settled.forEach((s, i) => {
    const name = fetchers[i][0];
    if (s.status === 'fulfilled') {
      merged.push(...s.value.items);
      perSource.push({
        source: s.value.source ?? name,
        sampleSize: s.value.items.length,
        searchUrl: s.value.searchUrl ?? null,
      });
    } else {
      console.warn(`[ptComparison] ${name} failed: ${s.reason?.message ?? s.reason}`);
      perSource.push({ source: name, sampleSize: 0, error: String(s.reason?.message ?? s.reason) });
    }
  });

  const criteria = comparisonCriteria(listing);
  const items = dedupe(merged);
  const sourceLabel =
    perSource.filter((s) => s.sampleSize > 0).map((s) => s.source).join(' + ') || 'pt';
  const final = finalizeComparison({ items, source: sourceLabel, criteria, listing });

  // Primary link: prefer OLX's search URL (most reliable), else the first that
  // produced one — so the popover's "open this search" always points somewhere.
  const primary =
    perSource.find((s) => s.source === 'olx.pt' && s.searchUrl) ??
    perSource.find((s) => s.searchUrl);

  return { ...final, searchUrl: primary?.searchUrl ?? null, sources: perSource };
}
