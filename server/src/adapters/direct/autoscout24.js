// Direct AutoScout24 scraper (DATA_SOURCE=direct) — no API key, no Apify.
//
// AutoScout24 serves its search results as a normal HTML page with the full
// result set embedded as JSON in <script id="__NEXT_DATA__"> (verified
// 2026-06-11: plain fetch with a desktop User-Agent returns HTTP 200).
// We build the public search URL from our filters, parse that JSON out, and
// map `props.pageProps.listings` (20 per page) into the normalised shape.
//
// Search cards often omit CO₂ (shown as "- (g/km)"); the detail page exposes
// `vehicle.co2emissionInGramPerKmWithFallback.raw` plus exact kW/displacement,
// so `enrichListing()` lazily fills those in for the ISV calculation.

import {
  pick,
  intFrom,
  canonicalFuel,
  canonicalTransmission,
  parseYear,
  inferEmissionStandard,
  slugify,
} from '../normalize.js';
import { missingListingFields } from '../../engine/landedCost.js';

const BASE_URL = 'https://www.autoscout24.de';
const PAGE_SIZE = 20; // AS24 serves 20 listings per search page
const MAX_PAGES = 20; // AS24 hard-caps pagination at 20 pages

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml',
};

// Our canonical fuel labels → AS24 `fuel` query codes.
const FUEL_CODES = {
  petrol: 'B',
  diesel: 'D',
  electric: 'E',
  hybrid: '2',
  phev: '3',
  lpg: 'L',
  cng: 'C',
};

// UI body-type labels → AS24 `body` query codes.
const BODY_CODES = {
  small: '1',
  convertible: '2',
  coupé: '3',
  coupe: '3',
  suv: '4',
  estate: '5',
  saloon: '6',
  van: '7',
};

/**
 * Public search URL for one results page. Exported for tests.
 *
 * `sort`/`desc` drive AS24's result ordering — the daily batch rotates these
 * (see SWEEP_SORTS) so successive runs page through different ~400-card windows
 * instead of re-reading the same top cards. Defaults reproduce the UI's order.
 */
export function buildSearchUrl(
  filters = {},
  { country = 'D', page = 1, includeModel = true, sort = 'standard', desc = 0 } = {}
) {
  let path = '/lst';
  if (filters.brand) {
    path += `/${slugify(filters.brand)}`;
    if (filters.model && includeModel) path += `/${slugify(filters.model)}`;
  }

  const params = new URLSearchParams({
    atype: 'C', // cars
    cy: country,
    damaged_listing: 'exclude',
    desc: String(desc === 1 || desc === '1' ? 1 : 0),
    sort: String(sort || 'standard'),
    ustate: 'N,U', // new + used (excludes damaged/classic oddities)
    page: String(page),
  });
  if (filters.priceMin != null) params.set('pricefrom', String(filters.priceMin));
  if (filters.priceMax != null) params.set('priceto', String(filters.priceMax));
  if (filters.yearFrom != null) params.set('fregfrom', String(filters.yearFrom));
  if (filters.maxMileageKm != null) params.set('kmto', String(filters.maxMileageKm));
  if (Array.isArray(filters.fuelTypes) && filters.fuelTypes.length) {
    const codes = filters.fuelTypes
      .map((f) => FUEL_CODES[String(f).toLowerCase()])
      .filter(Boolean);
    if (codes.length) params.set('fuel', codes.join(','));
  }
  if (filters.transmission && filters.transmission.toLowerCase() !== 'any') {
    const code = filters.transmission.toLowerCase() === 'manual' ? 'M' : 'A';
    params.set('gear', code);
  }
  if (filters.bodyType) {
    const code = BODY_CODES[String(filters.bodyType).toLowerCase()];
    if (code) params.set('body', code);
  }
  return `${BASE_URL}${path}?${params}`;
}

/** Pull the parsed __NEXT_DATA__ JSON out of an AS24 HTML page, or null. */
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

// German-localized number → integer: "182,00" → 182, "1.998" → 1998.
// intFrom would mash decimals into the integer ("182,00" → 18200).
function germanInt(text) {
  const n = Number(String(text).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

// "135 kW (184 PS)" → 135, "182,00 g/km (komb.)" → 182: match the number
// directly before its unit, then parse it as a German-formatted number.
function unitInt(text, unitRe) {
  const m = String(text ?? '').match(unitRe);
  return m ? germanInt(m[1]) : null;
}

// vehicleDetails is a flat icon+text list on the search card; it's the only
// place the card exposes power and (sometimes) CO₂.
function detailByIcon(card, iconName) {
  const entry = (card.vehicleDetails ?? []).find((d) => d.iconName === iconName);
  return entry && !entry.isPlaceholder ? entry.data : null;
}

/** Map one search-card listing object → our normalised listing shape. */
export function mapListing(card = {}, referenceYear) {
  const vehicle = card.vehicle ?? {};
  const tracking = card.tracking ?? {};
  const year = parseYear(pick(tracking.firstRegistration, detailByIcon(card, 'calendar')));
  const emission = inferEmissionStandard(year);
  const images = card.images ?? [];
  const url = card.url ? new URL(card.url, BASE_URL).href : null;

  return {
    id: String(pick(card.id, url, '')),
    brand: pick(vehicle.make, vehicle.makeName),
    model: pick(vehicle.model, vehicle.modelGroup),
    year,
    firstRegYear: year,
    firstRegMonth: null,
    mileageKm: intFrom(pick(tracking.mileage, vehicle.mileageInKm)),
    fuelType: canonicalFuel(pick(vehicle.fuel, tracking.fuelType)),
    transmission: canonicalTransmission(vehicle.transmission),
    // German body labels ("Limousine") don't match the UI's English filter
    // values; body filtering happens server-side via the `body` URL param, so
    // leave this null rather than have the post-filter wrongly drop listings.
    bodyType: null,
    priceEur: intFrom(pick(tracking.price, card.price?.priceFormatted)),
    displacementCm3: intFrom(vehicle.engineDisplacementInCCM),
    powerKw: unitInt(detailByIcon(card, 'speedometer'), /([\d.,]+)\s*kW/i),
    co2GKm: unitInt(detailByIcon(card, 'leaf'), /([\d.,]+)\s*g\/km/i),
    emissionStandard: emission.standard,
    emissionStandardInferred: emission.inferred,
    location: {
      zip: pick(card.location?.zip, card.location?.zipCode),
      country: pick(card.location?.countryCode, 'DE'),
    },
    thumbnailUrl: Array.isArray(images) ? pick(images[0]?.url, images[0]) : null,
    url,
    ageYears: year != null ? Math.max(0, referenceYear - year) : null,
  };
}

async function fetchPage(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`AutoScout24 request failed (${res.status}) for ${url}`);
  }
  return res.text();
}

function listingsFrom(html) {
  return extractNextData(html)?.props?.pageProps?.listings ?? [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Search AutoScout24 directly, paginating until `maxResults` or the last page.
 *
 * Model slugs are guessed from the filter text; when the model path yields
 * nothing (wrong slug → empty/404 page), we retry brand-only and let the
 * shared post-filter narrow by model substring.
 *
 * @param {object} filters  see PLAN.md §3
 * @param {object} cfg      { maxResults, country, requestDelayMs, fetchImpl }
 * @returns {Promise<object[]>} normalised listings (CO₂ may still be null —
 *   see enrichListing)
 */
export async function searchAutoScout24(filters = {}, cfg = {}) {
  const {
    maxResults = 50,
    country = 'D',
    requestDelayMs = 300,
    referenceYear = new Date().getFullYear(),
    sort = 'standard',
    desc = 0,
    fetchImpl = fetch,
  } = cfg;

  const collect = async (includeModel) => {
    const out = [];
    const pages = Math.min(MAX_PAGES, Math.ceil(maxResults / PAGE_SIZE));
    for (let page = 1; page <= pages; page++) {
      const url = buildSearchUrl(filters, { country, page, includeModel, sort, desc });
      let cards;
      try {
        cards = listingsFrom(await fetchPage(url, fetchImpl));
      } catch (err) {
        // A 404 on a guessed model path is expected; rethrow anything else
        // only if we have nothing at all yet.
        if (out.length) break;
        throw err;
      }
      out.push(...cards);
      if (cards.length < PAGE_SIZE) break;
      if (page < pages) await sleep(requestDelayMs);
    }
    return out;
  };

  let cards;
  try {
    cards = await collect(true);
  } catch {
    cards = [];
  }
  if (!cards.length && filters.brand && filters.model) {
    // Model slug probably wrong for AS24's URL scheme — search the brand and
    // rely on the post-filter's model substring match.
    cards = await collect(false);
  }

  return cards.slice(0, maxResults).map((card) => mapListing(card, referenceYear));
}

/**
 * Fetch a listing's detail page and fill in fields the search card lacked
 * (CO₂, exact kW, displacement), reporting *why* a gap remains so the batch can
 * retry transient failures without re-hammering terminal ones. Returns
 * `{ listing, enrichStatus, missingFields }`:
 *
 *   - `complete`       — every ISV field the calc needs is now present.
 *   - `enrich_pending` — the detail fetch/parse FAILED (network, 403, no
 *                        `__NEXT_DATA__`). The data probably exists; retry next
 *                        run. Original (null) fields are kept.
 *   - `source_missing` — the detail page loaded fine but genuinely omits the
 *                        field. Terminal — no retry can ever fix it.
 *
 * A listing already carrying everything skips the fetch entirely (`complete`).
 *
 * @param {object} listing   normalised listing with a `url`
 * @param {object} [opts]    { fetchImpl }
 */
export async function enrichListing(listing, opts = {}) {
  const { fetchImpl = fetch } = opts;
  const before = missingListingFields(listing);
  if (!before.length) return { listing, enrichStatus: 'complete', missingFields: [] };

  // No usable detail page to consult — this source can't fill the gap, so it's
  // terminal for this car rather than a retryable fetch failure.
  if (!listing?.url || !listing.url.startsWith(BASE_URL)) {
    return { listing, enrichStatus: 'source_missing', missingFields: before };
  }

  let vehicle;
  try {
    const html = await fetchPage(listing.url, fetchImpl);
    vehicle = extractNextData(html)?.props?.pageProps?.listingDetails?.vehicle;
  } catch {
    return { listing, enrichStatus: 'enrich_pending', missingFields: before };
  }
  // Page came back but the embedded JSON didn't parse / had no vehicle block —
  // treat as a transient parse failure (the data likely exists), retry next run.
  if (!vehicle) return { listing, enrichStatus: 'enrich_pending', missingFields: before };

  const co2 = pick(
    vehicle.co2emissionInGramPerKmWithFallback?.raw,
    vehicle.rawData?.fuels?.primary?.co2emissionInGramPerKmWithFallback?.raw
  );
  const enriched = {
    ...listing,
    co2GKm: listing.co2GKm ?? intFrom(co2),
    powerKw: listing.powerKw ?? intFrom(vehicle.rawPowerInKw),
    displacementCm3: listing.displacementCm3 ?? intFrom(vehicle.rawDisplacementInCCM),
  };
  const after = missingListingFields(enriched);
  // Detail page loaded but still no CO₂/displacement → the source simply doesn't
  // publish it. Terminal, not a retry candidate.
  return {
    listing: enriched,
    enrichStatus: after.length ? 'source_missing' : 'complete',
    missingFields: after,
  };
}
