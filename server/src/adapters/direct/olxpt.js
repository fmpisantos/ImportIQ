// OLX Portugal client for the PT market comparison — uses OLX's open public
// JSON API (no key, verified 2026-06-11):
//
//   GET https://www.olx.pt/api/v1/offers/?category_id=<brand cat>&…
//
// On OLX.pt each car brand is a *subcategory* of "Carros" (378) — passing a
// brand filter param is rejected, so we resolve the brand to its category id
// via the static map below (extracted from the site's category tree; ids are
// slow-moving). Year and mileage are real dynamic filters
// (`filter_float_year:from`, `filter_float_quilometros:to`), and the model is
// matched with the free-text `query` param — model naming differs between the
// German sites and OLX ("320i" vs "Série 3"), so free text beats guessing
// OLX's model enum slugs.

import { summarise, comparisonCriteria } from '../ptMarketClient.js';

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

function priceOf(item) {
  const param = (item.params ?? []).find((p) => p.key === 'price');
  return param?.value?.value ?? null;
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

  const params = new URLSearchParams({
    category_id: String(brandCategoryId(listing.brand)),
    limit: String(limit),
    'filter_float_year:from': String(criteria.yearRange[0]),
    'filter_float_year:to': String(criteria.yearRange[1]),
    'filter_float_quilometros:from': String(criteria.mileageRangeKm[0]),
    'filter_float_quilometros:to': String(criteria.mileageRangeKm[1]),
  });
  if (listing.model) params.set('query', String(listing.model));

  const res = await fetchImpl(`${BASE_URL}?${params}`, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OLX.pt request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const payload = await res.json();
  const items = (payload?.data ?? []).map((it) => ({ priceEur: priceOf(it) }));
  return summarise(items, 'olx.pt', criteria);
}
