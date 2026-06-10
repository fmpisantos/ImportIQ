// AutoUncle site adapter for the Apify path.
//
// Default actor: lofomachines/autouncle-scraper — URL-driven (startUrls +
// maxPages). AutoUncle encodes make/model in the path, e.g.
//   https://www.autouncle.de/de/gebrauchtwagen/Fiat/Panda
// The locale segment ("de/gebrauchtwagen", "it/auto-usate", "en/used-cars")
// is configurable. Price/year/mileage/fuel are enforced by the shared
// post-filter rather than encoded into the URL, so they stay reliable across
// locales. Paste an exact AutoUncle search URL via cfg.startUrls for full
// filter fidelity.

import { proxyInput } from '../apifyClient.js';
import {
  pick,
  intFrom,
  canonicalFuel,
  canonicalTransmission,
  parseYear,
  inferEmissionStandard,
} from '../normalize.js';

export const key = 'autouncle';
export const label = 'AutoUncle';

// Title-case a path segment the way AutoUncle expects ("Fiat", "Panda").
const cap = (s) =>
  String(s ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join('-');

/**
 * @param {object} filters
 * @param {object} cfg  { actorId, maxPages, baseUrl, listPath, startUrls? }
 */
export function buildInput(filters = {}, cfg = {}) {
  const input = {
    maxPages: cfg.maxPages ?? 2,
    proxyConfiguration: proxyInput(),
  };

  if (Array.isArray(cfg.startUrls) && cfg.startUrls.length) {
    input.startUrls = cfg.startUrls.map((url) => ({ url }));
    return input;
  }

  const base = (cfg.baseUrl ?? 'https://www.autouncle.de').replace(/\/+$/, '');
  const listPath = (cfg.listPath ?? '/de/gebrauchtwagen').replace(/\/+$/, '');
  let url = `${base}${listPath}`;
  if (filters.brand) url += `/${encodeURIComponent(cap(filters.brand))}`;
  if (filters.brand && filters.model) url += `/${encodeURIComponent(cap(filters.model))}`;

  input.startUrls = [{ url }];
  return input;
}

export function mapItem(item = {}, referenceYear) {
  const year =
    parseYear(pick(item.registrationDate, item.firstRegistration, item.year, item.registration)) ??
    null;
  const emission = inferEmissionStandard(year);

  return {
    id: String(pick(item.id, item.detailUrl, item.externalUrl, item.url, '')),
    brand: pick(item.make, item.brand, item.manufacturer),
    model: pick(item.model, item.modelName),
    year,
    firstRegYear: year,
    firstRegMonth: null,
    mileageKm: intFrom(pick(item.mileage, item.mileageValue, item.km)),
    fuelType: canonicalFuel(pick(item.engineFuel, item.fuel, item.fuelType)),
    transmission: canonicalTransmission(pick(item.transmission, item.gearbox)),
    bodyType: pick(item.bodyType, item.category),
    priceEur: intFrom(pick(item.priceValue, item.price, item.priceEur)),
    displacementCm3: intFrom(pick(item.displacement, item.engineSize, item.cubicCapacity)),
    powerKw: intFrom(pick(item.powerKw, item.power, item.kw)),
    co2GKm: intFrom(pick(item.co2Emissions, item.co2)),
    emissionStandard: emission.standard,
    emissionStandardInferred: emission.inferred,
    location: {
      zip: pick(item.zip, item.zipCode, item.postalCode),
      country: pick(item.country, item.countryCode, 'DE'),
    },
    // AutoUncle aggregates other sites — externalUrl points to the source ad.
    thumbnailUrl: pick(item.imageUrl, item.image, item.thumbnailUrl),
    url: pick(item.externalUrl, item.detailUrl, item.url, item.link),
    ageYears: year != null ? Math.max(0, referenceYear - year) : null,
  };
}
