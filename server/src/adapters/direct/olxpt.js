// OLX Portugal client for the PT market comparison — uses OLX's open public
// JSON API (no key, verified 2026-06-11):
//
//   GET https://www.olx.pt/api/v1/offers/?category_id=<brand cat>&…
//
// On OLX.pt each car brand is a *subcategory* of "Carros" (378) — passing a
// brand filter param is rejected, so we resolve the brand to its category id
// via the static map below (extracted from the site's category tree; ids are
// slow-moving). Year and mileage are real dynamic filters
// (`filter_float_year:from`, `filter_float_quilometros:to`).
//
// Model + fuel narrowing (PT-average accuracy, 2026-06-13): a bare free-text
// `query=<model>` matches "116" anywhere in an ad (power "116 cv", mileage
// "116.000 km", phone) and so averages in M4s, X3s and 320ds. We instead:
//   1. send the verified `filter_enum_combustivel` fuel filter and a *family*
//      free-text query (model trim/fuel suffix stripped: "116i" → "116");
//   2. post-filter the returned listings on their own structured `params`
//      (modelo / combustivel / gearbox) so non-comparables that slip through
//      are dropped (mirrors normalize.js#matchesFilters — items missing a
//      field are kept, since we can't prove they violate it);
//   3. reject price outliers (IQR) before averaging.

import {
  comparisonCriteria,
  comparableMatches,
  finalizeComparison,
} from '../ptMarketClient.js';
import { classifyTrim } from '../../engine/trim.js';
import {
  canonicalFuel,
  canonicalTransmission,
  intFrom,
  leadingInt,
  normalizeModelKey,
} from '../normalize.js';

// normalizeModelKey now lives in the shared normalize module; re-export it here
// so existing importers (and tests) of this adapter keep working.
export { normalizeModelKey };

const BASE_URL = 'https://www.olx.pt/api/v1/offers/';
const CARS_CATEGORY = 378; // "Carros" — parent of all brand categories

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// Brand → OLX.pt category id (children of category 378, captured 2026-06-11).
export const BRAND_CATEGORIES = {
  abarth: 4914, ac: 5222, acura: 5168, aiways: 5174, aixam: 5138,
  'alfa romeo': 763, alpina: 5139, alpine: 5133, 'aston martin': 753,
  audi: 751, austin: 5134, bedford: 5219, bentley: 743, bmw: 741, byd: 5217,
  cadillac: 5142, caterham: 5143, chevrolet: 731, chrysler: 729, citroen: 727,
  cupra: 5137, dacia: 721, daewoo: 719, daihatsu: 717, daimler: 5468,
  datsun: 4922, dodge: 707, ds: 4879, ferrari: 701, fiat: 699, fisker: 5145,
  ford: 697, geely: 5477, genesis: 5403, gmc: 689, honda: 683, hummer: 681,
  hyundai: 679, infiniti: 5147, isuzu: 673, iveco: 5148, jaguar: 671,
  jeep: 669, kia: 665, lada: 663, lamborghini: 661, lancia: 659,
  'land rover': 657, lexus: 655, ligier: 5151, lincoln: 5183, lotus: 649,
  man: 5152, maserati: 645, maybach: 5153, mazda: 641, mclaren: 5154,
  'mercedes-benz': 637, mg: 633, microcar: 5155, mini: 631, mitsubishi: 629,
  morgan: 5156, nissan: 621, opel: 617, peugeot: 613, polestar: 5159,
  pontiac: 5160, porsche: 607, renault: 603, 'rolls royce': 601, rover: 817,
  saab: 815, seat: 809, shelby: 5162, skoda: 805, smart: 803, ssangyong: 801,
  subaru: 797, suzuki: 795, tata: 791, tesla: 4885, toyota: 789,
  triumph: 5163, umm: 819, vauxhall: 781, volvo: 775, vw: 777, wiesmann: 5165,
  zeekr: 5475,
};

// Cross-site naming differences → OLX brand keys.
const BRAND_ALIASES = {
  volkswagen: 'vw',
  mercedes: 'mercedes-benz',
  'mercedes benz': 'mercedes-benz',
  citroën: 'citroen',
  škoda: 'skoda',
  'rolls-royce': 'rolls royce',
  'land-rover': 'land rover',
  'alfa-romeo': 'alfa romeo',
};

/** OLX category id for a brand name (any common spelling), or the cars root. */
export function brandCategoryId(brand) {
  const key = String(brand ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  return BRAND_CATEGORIES[BRAND_ALIASES[key] ?? key] ?? CARS_CATEGORY;
}

// Canonical fuel → OLX `combustivel` enum slug (verified live 2026-06-13).
// Note: petrol is `gasolina`, not `petrol`. Only the four confirmed slugs are
// sent as a query filter; other fuels rely on the defensive post-filter alone.
const OLX_FUEL_ENUM = {
  Petrol: 'gasolina',
  Diesel: 'diesel',
  PHEV: 'plugin-hybrid',
  Electric: 'electrico',
};

// cv (metric hp, what OLX reports) → kW, so engine power compares like-for-like
// against the German listing's kW. 1 cv = 0.7355 kW.
const cvToKw = (cv) => (cv != null ? Math.round(cv * 0.7355) : null);

function priceOf(item) {
  const param = (item.params ?? []).find((p) => p.key === 'price');
  return param?.value?.value ?? null;
}

/** Pull a structured param's display value out of OLX's {key,label}|scalar shape. */
function paramOf(item, key) {
  const v = (item.params ?? []).find((p) => p.key === key)?.value;
  if (v == null) return null;
  if (typeof v === 'object') return v.label ?? v.key ?? v.value ?? null;
  return v;
}

/**
 * Reduce one OLX offer to the comparable shape: price/link plus the structured
 * specs the shared matcher (ptMarketClient.js#comparableMatches) and the
 * mileage regression need — model, fuel, transmission, mileage, year, engine
 * power (→ kW) and displacement. Missing fields stay null (matcher-tolerant).
 */
function extractComparable(item) {
  return {
    priceEur: priceOf(item),
    url: item.url,
    title: item.title,
    model: paramOf(item, 'modelo'),
    fuel: canonicalFuel(paramOf(item, 'combustivel')),
    transmission: canonicalTransmission(paramOf(item, 'gearbox')),
    mileageKm: intFrom(paramOf(item, 'quilometros')),
    year: intFrom(paramOf(item, 'year')),
    powerKw: cvToKw(leadingInt(paramOf(item, 'engine_power'))),
    displacementCm3: leadingInt(paramOf(item, 'engine_capacity')),
    // Trim tier from the ad title (OLX has no structured trim field) — feeds the
    // shared matcher's like-for-like trim narrowing. A title that omits the trim
    // falls back to 'base'; the matcher treats that tolerantly.
    trimTier: classifyTrim(`${item.title ?? ''} ${paramOf(item, 'modelo') ?? ''}`).tier,
  };
}

const WEB_BASE = 'https://www.olx.pt';
const CARS_PATH = 'carros-motos-e-barcos/carros'; // root path when the brand slug is unknown

/**
 * Human-facing OLX.pt search URL equivalent to the API query — so users can
 * open the exact search behind the comparison. Pure — unit-testable.
 *
 * Brand slugs can't be derived from brand names (e.g. category 777 is
 * `volkswagen-vw`), so the caller passes the category path reported by the API
 * response itself (`metadata.adverts.config.targeting.cat_l*_path`).
 *
 * @param {object} criteria  comparison window (yearRange, mileageRangeKm)
 * @param {string} [model]   free-text model query
 * @param {string} [brandSlug]  brand category path segment from the API response
 * @param {string} [fuelEnum]  OLX `combustivel` slug, to mirror the API filter
 */
export function buildSearchUrl(criteria, model, brandSlug, fuelEnum) {
  const path = brandSlug ? `${CARS_PATH}/${brandSlug}` : CARS_PATH;
  const query = model ? `/q-${encodeURIComponent(String(model))}` : '';
  const params = new URLSearchParams({
    'search[filter_float_year:from]': String(criteria.yearRange[0]),
    'search[filter_float_year:to]': String(criteria.yearRange[1]),
    'search[filter_float_quilometros:from]': String(criteria.mileageRangeKm[0]),
    'search[filter_float_quilometros:to]': String(criteria.mileageRangeKm[1]),
  });
  if (fuelEnum) params.set('search[filter_enum_combustivel][0]', fuelEnum);
  return `${WEB_BASE}/${path}${query}/?${params}`;
}

// Up to two pages of 50 — enough to make popular models a real sample without
// hammering OLX. The defensive post-filter + IQR trim run over the union.
const MAX_COMPARABLES = 100;
const PAGE_SIZE = 50;

/**
 * Fetch matched OLX comparables for one listing — the raw building block the
 * multi-source orchestrator merges. Paginates via `offset`, post-filters every
 * offer through the shared `comparableMatches`, and returns the matched
 * comparables (NOT yet IQR-trimmed/averaged) plus the human search URL.
 *
 * @param {object} listing  normalised listing (brand/model/year/mileageKm)
 * @param {object} [opts]   { fetchImpl, pageSize, maxComparables }
 * @returns {Promise<{ items: object[], searchUrl: string, criteria: object,
 *                     source: 'olx.pt' }>}
 */
export async function fetchComparables(listing, opts = {}) {
  const { fetchImpl = fetch, pageSize = PAGE_SIZE, maxComparables = MAX_COMPARABLES } = opts;
  const criteria = comparisonCriteria(listing);
  const modelQuery = listing.model ? normalizeModelKey(listing.model) : undefined;
  const fuelEnum = OLX_FUEL_ENUM[listing.fuelType];

  const raw = [];
  let brandSlug;
  const pages = Math.max(1, Math.ceil(maxComparables / pageSize));
  for (let page = 0; page < pages; page++) {
    const params = new URLSearchParams({
      category_id: String(brandCategoryId(listing.brand)),
      limit: String(pageSize),
      offset: String(page * pageSize),
      'filter_float_year:from': String(criteria.yearRange[0]),
      'filter_float_year:to': String(criteria.yearRange[1]),
      'filter_float_quilometros:from': String(criteria.mileageRangeKm[0]),
      'filter_float_quilometros:to': String(criteria.mileageRangeKm[1]),
    });
    if (modelQuery) params.set('query', modelQuery);
    if (fuelEnum) params.set('filter_enum_combustivel[0]', fuelEnum);

    let payload;
    try {
      const res = await fetchImpl(`${BASE_URL}?${params}`, { headers: HEADERS });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OLX.pt request failed (${res.status}): ${body.slice(0, 300)}`);
      }
      payload = await res.json();
    } catch (err) {
      if (raw.length) break; // a later page failing shouldn't drop earlier results
      throw err;
    }
    const batch = payload?.data ?? [];
    raw.push(...batch);
    if (brandSlug === undefined) {
      // The deepest category path in the response is the brand slug (when a
      // brand category was queried) — authoritative, unlike guessing from name.
      brandSlug = payload?.metadata?.adverts?.config?.targeting?.cat_l2_path || undefined;
    }
    if (batch.length < pageSize) break; // last page
  }

  const items = raw.map(extractComparable).filter((c) => comparableMatches(c, listing));
  const searchUrl = buildSearchUrl(criteria, modelQuery, brandSlug, fuelEnum);
  return { items, searchUrl, criteria, source: 'olx.pt' };
}

/**
 * OLX-only PT comparison for one listing (same shape as the official/mock
 * providers). Kept for the single-source path and the orchestrator's per-source
 * breakdown; the multi-source combiner (./ptComparison.js) reuses
 * `fetchComparables` directly.
 *
 * @param {object} listing  normalised listing (brand/model/year/mileageKm)
 * @param {object} [opts]   { fetchImpl, pageSize, maxComparables }
 */
export async function getComparisonDirect(listing, opts = {}) {
  const { items, searchUrl, criteria } = await fetchComparables(listing, opts);
  const final = finalizeComparison({ items, source: 'olx.pt', criteria, listing });
  return {
    ...final,
    searchUrl,
    sources: [{ source: 'olx.pt', sampleSize: final.sampleSize, searchUrl }],
  };
}
