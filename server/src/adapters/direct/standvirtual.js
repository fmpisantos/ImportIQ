// Direct Standvirtual scraper for the PT market comparison (DATA_SOURCE=direct).
//
// Standvirtual.com is the dominant Portuguese used-car marketplace and skews
// toward dealer/resale prices, so it complements OLX.pt (private-seller-heavy)
// for an unbiased PT average. It runs on the OLX-Group "OTOMOTO" platform: a
// Next.js app that server-renders results and embeds the GraphQL result set as
// JSON in <script id="__NEXT_DATA__">, under `props.pageProps.urqlState`
// (an urql cache keyed by query hash → { data: "<json string>" }), each holding
// an `advertSearch.edges[].node`.
//
// ⚠️ Best-effort, pending live field verification (mirrors the README PT
// read-access caveat). The search URL + year filter are verified live
// (2026-06-13: a 2012–2014 filter returned only 2012–2014 cars); the
// __NEXT_DATA__ node→comparable mapping uses the documented OTOMOTO shape with
// tolerant field paths and is covered by a fixture test. If a real run parses
// zero listings, the adapter logs a warning and contributes nothing (the
// comparison falls back to the other sources) rather than failing the search.
// The per-source sample count is surfaced in the comparison so a silently-empty
// source is visible, not hidden.

import {
  slugify,
  canonicalFuel,
  canonicalTransmission,
  intFrom,
  leadingInt,
  normalizeModelKey,
} from '../normalize.js';
import {
  comparisonCriteria,
  comparableMatches,
  withinComparisonWindow,
} from '../ptMarketClient.js';
import { classifyTrim } from '../../engine/trim.js';

const BASE_URL = 'https://www.standvirtual.com';
const MAX_PAGES = 2;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml',
};

// cv (metric hp, what PT sites report) → kW, to compare against the German
// listing's kW. 1 cv = 0.7355 kW.
const cvToKw = (cv) => (cv != null ? Math.round(cv * 0.7355) : null);

/**
 * Public Standvirtual search URL for one page. The model is sent as the
 * verified `filter_enum_model` enum (e.g. "320d" → family key "320"), which
 * narrows server-side to that model only (mixed brand pages otherwise bury the
 * target model); `modelKey` is omitted on the brand-only fallback. Year window
 * + mileage window are real `filter_float_*` filters (year verified live).
 * Exported for tests.
 */
export function buildSearchUrl(listing, criteria, page = 1, { modelKey } = {}) {
  const brand = slugify(listing.brand);
  const path = brand ? `/carros/${brand}` : '/carros';
  const params = new URLSearchParams({
    'search[filter_float_first_registration_year:from]': String(criteria.yearRange[0]),
    'search[filter_float_first_registration_year:to]': String(criteria.yearRange[1]),
    'search[filter_float_mileage:from]': String(criteria.mileageRangeKm[0]),
    'search[filter_float_mileage:to]': String(criteria.mileageRangeKm[1]),
  });
  if (modelKey) params.set('search[filter_enum_model][0]', modelKey);
  if (page > 1) params.set('page', String(page));
  return `${BASE_URL}${path}?${params}`;
}

/** Pull the parsed __NEXT_DATA__ JSON out of a Standvirtual HTML page, or null. */
export function extractNextData(html) {
  const m = String(html).match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>(.*?)<\/script>/s
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Walk the OTOMOTO __NEXT_DATA__ shape and collect raw advert nodes. Tries the
 * urql cache first (the live shape), then a couple of plain fallbacks, so a
 * platform tweak that moves the data only needs one more candidate path here.
 */
export function parseListings(nextData) {
  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) return [];

  const nodes = [];
  const pushEdges = (search) => {
    for (const edge of search?.edges ?? []) {
      if (edge?.node) nodes.push(edge.node);
    }
  };

  // 1) urql cache: { [hash]: { data: "<json string>" | {…} } }
  const urql = pageProps.urqlState;
  if (urql && typeof urql === 'object') {
    for (const entry of Object.values(urql)) {
      let data = entry?.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          continue;
        }
      }
      if (data?.advertSearch) pushEdges(data.advertSearch);
    }
  }
  // 2) plain fallbacks seen on sibling deployments
  if (!nodes.length) pushEdges(pageProps.advertSearch);
  if (!nodes.length && Array.isArray(pageProps.listings)) nodes.push(...pageProps.listings);

  return nodes;
}

/** node.parameters/[].{key,value,displayValue} → { key: param } map. */
function paramMap(node) {
  const arr = node.parameters ?? node.params ?? [];
  const m = {};
  for (const p of arr) {
    if (p && p.key != null) m[p.key] = p;
  }
  return m;
}

// Label vs raw value: text fields (fuel) read best from the localized
// displayValue (canonicalFuel maps "Gasolina"/"Diesel"); numeric fields read
// best from the clean `value` ("1995", "153000") to skip unit parsing.
const disp = (m, k) => m[k]?.displayValue ?? m[k]?.value ?? null;
const val = (m, k) => m[k]?.value ?? m[k]?.displayValue ?? null;

function priceOf(node) {
  return intFrom(
    node.price?.amount?.units ?? node.price?.value ?? node.price?.amount ?? node.price
  );
}

/** One advert node → the shared comparable shape (matcher-tolerant nulls). */
export function toComparable(node) {
  const m = paramMap(node);
  return {
    priceEur: priceOf(node),
    url: node.url ? new URL(node.url, BASE_URL).href : null,
    title: node.title ?? node.shortDescription ?? null,
    model: disp(m, 'model'),
    fuel: canonicalFuel(disp(m, 'fuel_type')),
    transmission: canonicalTransmission(disp(m, 'gearbox')),
    mileageKm: intFrom(val(m, 'mileage')),
    year: intFrom(val(m, 'first_registration_year')),
    powerKw: cvToKw(leadingInt(val(m, 'engine_power'))),
    displacementCm3: leadingInt(val(m, 'engine_capacity')),
    // Trim tier from the ad title/version text — feeds the shared matcher's
    // like-for-like trim narrowing (a title without a trim falls back to 'base').
    trimTier: classifyTrim(
      `${node.title ?? node.shortDescription ?? ''} ${disp(m, 'version') ?? ''} ${disp(m, 'model') ?? ''}`
    ).tier,
  };
}

async function fetchPage(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Standvirtual request failed (${res.status}) for ${url}`);
  return res.text();
}

/**
 * Fetch matched Standvirtual comparables for one listing — the raw building
 * block the orchestrator merges with OLX. Paginates, parses __NEXT_DATA__,
 * post-filters through the shared matcher + comparison window.
 *
 * @param {object} listing  normalised listing (brand/model/year/mileageKm)
 * @param {object} [opts]   { fetchImpl, maxPages }
 * @returns {Promise<{ items, searchUrl, criteria, source: 'standvirtual' }>}
 */
export async function fetchComparables(listing, opts = {}) {
  const { fetchImpl = fetch, maxPages = MAX_PAGES } = opts;
  const criteria = comparisonCriteria(listing);
  // Family key for the model enum: "320d" → "320", "Golf" → "golf". A wrong
  // slug yields zero, so we fall back to a brand-only fetch and let the
  // post-filter narrow by model.
  const modelKey = listing.model ? normalizeModelKey(listing.model).toLowerCase() : undefined;

  const collect = async (key) => {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      let nodes;
      try {
        nodes = parseListings(
          extractNextData(await fetchPage(buildSearchUrl(listing, criteria, page, { modelKey: key }), fetchImpl))
        );
      } catch (err) {
        if (out.length) break; // partial pages are fine; first-page failure propagates
        throw err;
      }
      out.push(...nodes);
      if (!nodes.length) break; // no more results
    }
    return out;
  };

  let raw = await collect(modelKey);
  if (!raw.length && modelKey) raw = await collect(undefined); // brand-only fallback

  if (!raw.length) {
    console.warn(
      '[standvirtual] parsed 0 adverts from __NEXT_DATA__ — the OTOMOTO shape may have changed; see adapter note. Contributing nothing this run.'
    );
  }

  const items = raw
    .map(toComparable)
    .filter((c) => comparableMatches(c, listing))
    .filter((c) => withinComparisonWindow(c, criteria));

  return {
    items,
    searchUrl: buildSearchUrl(listing, criteria, 1, { modelKey }),
    criteria,
    source: 'standvirtual',
  };
}
