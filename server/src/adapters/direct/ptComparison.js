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
import { resolveVehicle } from '../../engine/vehicleResolver.js';

// Source name → raw-comparable fetcher. Each returns
// { items, searchUrl, criteria, source }.
const SOURCE_FETCHERS = {
  olx: fetchOlx,
  standvirtual: fetchStandvirtual,
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Drop the same car listed twice, WITHIN or ACROSS sources.
 *
 * A URL key alone is not enough: dealers cross-post the identical car to OLX.pt
 * *and* Standvirtual, and each platform mints its own URL — so URL-dedup leaves
 * the same vehicle counted twice. That double-counts its asking price in the
 * median AND inflates the sample size, defeating the low-confidence guard (an
 * X4 "market" built on one real listing looked like two). So we also key on a
 * content fingerprint — price + year + normalised title (the trim text, which is
 * identical across a dealer's cross-posts) — and treat a hit on EITHER key as a
 * duplicate. Year/mileage are deliberately excluded from the fingerprint: the
 * two platforms often omit or round them differently for the same car (OLX in
 * particular frequently has no year param), which would wrongly keep both
 * copies. Price + trim title is what a dealer's cross-posts reliably share, and
 * is specific enough that a same-priced collision across two genuinely different
 * cars is rare — and merging two real cars only shrinks the sample, biasing
 * toward "unreliable", which is the safe direction here.
 */
function dedupe(items) {
  const seenUrl = new Set();
  const seenContent = new Set();
  const out = [];
  for (const c of items) {
    const urlKey = c.url ? `url:${norm(c.url)}` : null;
    const contentKey = ['c', c.priceEur, norm(c.title ?? c.model)].join('|');
    if ((urlKey && seenUrl.has(urlKey)) || seenContent.has(contentKey)) continue;
    if (urlKey) seenUrl.add(urlKey);
    seenContent.add(contentKey);
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
  // Resolve the listing's free-text brand+model to the canonical catalog
  // identity (the fuzzy matcher) and search Portugal for THAT car — so the
  // brand+model shown on the card is the same brand+model we look up in PT. A
  // confident match renames the subject; a weak one leaves the raw strings.
  // `resolve: false` (used by the source-merge unit tests) skips this entirely.
  const resolved =
    opts.resolve === false ? null : resolveVehicle(listing.brand, listing.model, opts);
  const subject = resolved
    ? { ...listing, brand: resolved.brand, model: resolved.model }
    : listing;

  // Trust gate: without a model we can only match brand+year, which drags in
  // unrelated cars. Don't even fetch — return an empty, explicitly-unreliable
  // comparison so attachComparison withholds the verdict (verdict → 'unknown')
  // instead of presenting a brand-only average as the PT market value.
  if (!subject.model || !String(subject.model).trim()) {
    const criteria = comparisonCriteria(subject);
    return {
      ...finalizeComparison({ items: [], source: 'pt', criteria, listing: subject }),
      searchUrl: null,
      sources: [],
      resolvedVehicle: resolved ?? null,
    };
  }

  const enabled = opts.sources ?? getPtSourcesConfig();
  const fetchers = enabled
    .map((name) => [name, SOURCE_FETCHERS[name]])
    .filter(([, fn]) => typeof fn === 'function');

  const settled = await Promise.allSettled(
    fetchers.map(([, fn]) => fn(subject, opts))
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

  const criteria = comparisonCriteria(subject);
  const items = dedupe(merged);
  const sourceLabel =
    perSource.filter((s) => s.sampleSize > 0).map((s) => s.source).join(' + ') || 'pt';
  const final = finalizeComparison({ items, source: sourceLabel, criteria, listing: subject });

  // Primary link: prefer OLX's search URL (most reliable), else the first that
  // produced one — so the popover's "open this search" always points somewhere.
  const primary =
    perSource.find((s) => s.source === 'olx.pt' && s.searchUrl) ??
    perSource.find((s) => s.searchUrl);

  return {
    ...final,
    searchUrl: primary?.searchUrl ?? null,
    sources: perSource,
    resolvedVehicle: resolved ?? null,
  };
}
