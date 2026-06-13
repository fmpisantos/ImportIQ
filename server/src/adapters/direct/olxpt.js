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
  summarise,
  comparisonCriteria,
  rejectPriceOutliers,
} from '../ptMarketClient.js';
import { canonicalFuel, canonicalTransmission } from '../normalize.js';

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

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Strip a trailing fuel/trim suffix from a numeric model code so the free-text
 * query matches the model family rather than one variant: "320d" → "320",
 * "116i" → "116", "118d" → "118". Word/letter-led models are left untouched
 * ("Golf", "A4", "Série 3"). The post-filter then narrows by fuel. Pure.
 */
export function normalizeModelKey(model) {
  const s = String(model ?? '').trim();
  const m = s.match(/^(\d{2,4})\s*[a-z]{1,3}$/i);
  return m ? m[1] : s;
}

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

/** Reduce one OLX offer to the comparable shape (price/link + filterable specs). */
function extractComparable(item) {
  return {
    priceEur: priceOf(item),
    url: item.url,
    title: item.title,
    model: paramOf(item, 'modelo'),
    fuel: canonicalFuel(paramOf(item, 'combustivel')),
    transmission: canonicalTransmission(paramOf(item, 'gearbox')),
  };
}

/**
 * Defensive post-filter: does this OLX comparable actually match the listing on
 * model, fuel and transmission? A comparable missing one of those fields is not
 * dropped for it (mirrors normalize.js#matchesFilters). Model matching is
 * lenient — the listing's name and its stripped family key are both tried, and
 * either containing the other counts ("320d" listing ↔ OLX "320").
 */
function comparableMatches(c, listing) {
  if (listing.model && c.model) {
    const cm = norm(c.model);
    const candidates = [norm(listing.model), norm(normalizeModelKey(listing.model))];
    if (!candidates.some((x) => x && (cm.includes(x) || x.includes(cm)))) return false;
  }
  if (listing.fuelType && c.fuel && norm(c.fuel) !== norm(listing.fuelType)) return false;
  if (
    listing.transmission &&
    c.transmission &&
    norm(c.transmission) !== norm(listing.transmission)
  )
    return false;
  return true;
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

/**
 * Fetch comparable PT listings for one normalised listing and reduce them to
 * the comparison object (same shape as the official/mock providers).
 *
 * @param {object} listing  normalised listing (brand/model/year/mileageKm)
 * @param {object} [opts]   { fetchImpl, limit }
 */
export async function getComparisonDirect(listing, opts = {}) {
  const { fetchImpl = fetch, limit = 50 } = opts;
  const criteria = comparisonCriteria(listing);
  const modelQuery = listing.model ? normalizeModelKey(listing.model) : undefined;
  const fuelEnum = OLX_FUEL_ENUM[listing.fuelType];

  const params = new URLSearchParams({
    category_id: String(brandCategoryId(listing.brand)),
    limit: String(limit),
    'filter_float_year:from': String(criteria.yearRange[0]),
    'filter_float_year:to': String(criteria.yearRange[1]),
    'filter_float_quilometros:from': String(criteria.mileageRangeKm[0]),
    'filter_float_quilometros:to': String(criteria.mileageRangeKm[1]),
  });
  if (modelQuery) params.set('query', modelQuery);
  if (fuelEnum) params.set('filter_enum_combustivel[0]', fuelEnum);

  const res = await fetchImpl(`${BASE_URL}?${params}`, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OLX.pt request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const payload = await res.json();
  const comparables = (payload?.data ?? [])
    .map(extractComparable)
    .filter((c) => comparableMatches(c, listing));
  const items = rejectPriceOutliers(comparables);

  // The deepest category path in the response is the brand slug (when a brand
  // category was queried) — authoritative, unlike guessing from the brand name.
  const targeting = payload?.metadata?.adverts?.config?.targeting;
  const brandSlug = targeting?.cat_l2_path || undefined;
  const searchUrl = buildSearchUrl(criteria, modelQuery, brandSlug, fuelEnum);
  const summary = summarise(items, 'olx.pt', criteria);

  return {
    ...summary,
    searchUrl,
    // The criteria the comparison was actually narrowed on, for the UI popover.
    matchedCriteria: {
      model: listing.model ?? null,
      fuelType: listing.fuelType ?? null,
      transmission: listing.transmission ?? null,
    },
    // Too few comparables to trust the average — surface a caveat (PLAN.md §5).
    lowConfidence: summary.sampleSize < 5,
  };
}
