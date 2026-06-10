// mobile.de site adapter for the Apify path.
//
// Default actor: 3x1t/mobile-de-scraper — accepts structured make/model/query
// filters AND a startUrls passthrough, plus maxResults. We send structured
// filters (no fragile internal make-id mapping needed) and let the shared
// post-filter in apifySearch.js guarantee the results match exactly.

import { proxyInput } from '../apifyClient.js';
import {
  pick,
  intFrom,
  canonicalFuel,
  canonicalTransmission,
  parseYear,
  inferEmissionStandard,
} from '../normalize.js';

export const key = 'mobilede';
export const label = 'mobile.de';

/**
 * Build the actor input from our normalised filters.
 * @param {object} filters
 * @param {object} cfg  per-site config: { actorId, maxResults, startUrls? }
 */
export function buildInput(filters = {}, cfg = {}) {
  const input = {
    maxResults: cfg.maxResults ?? 50,
    proxyConfiguration: proxyInput(),
  };

  // An explicit search URL (pasted by the user / configured) wins — full filter
  // fidelity, no guessing.
  if (Array.isArray(cfg.startUrls) && cfg.startUrls.length) {
    input.startUrls = cfg.startUrls.map((url) => ({ url }));
    return input;
  }

  if (filters.brand) input.make = filters.brand;
  if (filters.model) input.model = filters.model;
  if (filters.priceMin != null) input.priceFrom = filters.priceMin;
  if (filters.priceMax != null) input.priceTo = filters.priceMax;
  if (filters.yearFrom != null) input.yearFrom = filters.yearFrom;
  if (filters.maxMileageKm != null) input.mileageTo = filters.maxMileageKm;
  if (Array.isArray(filters.fuelTypes) && filters.fuelTypes.length) {
    input.fuelType = filters.fuelTypes[0]; // actor takes a single value
  }
  if (filters.transmission && filters.transmission.toLowerCase() !== 'any') {
    input.transmission = filters.transmission;
  }
  return input;
}

/**
 * Map one raw dataset item → our normalised listing. Field names vary between
 * actor versions, so every lookup tries the common aliases.
 */
export function mapItem(item = {}, referenceYear) {
  const year =
    parseYear(pick(item.firstRegistration, item.firstRegistrationDate, item.year, item.registration)) ??
    null;
  const emission = inferEmissionStandard(year);
  const images = item.images ?? item.imageUrls ?? item.photos ?? [];

  return {
    id: String(pick(item.id, item.adId, item.mobileAdId, item.url, '')),
    brand: pick(item.make, item.makeName, item.brand, item.manufacturer),
    model: pick(item.model, item.modelName, item.modelDescription),
    year,
    firstRegYear: year,
    firstRegMonth: null,
    mileageKm: intFrom(pick(item.mileage, item.mileageKm, item.km, item.kilometers)),
    fuelType: canonicalFuel(pick(item.fuel, item.fuelType, item.fuelCategory)),
    transmission: canonicalTransmission(pick(item.gearbox, item.transmission)),
    bodyType: pick(item.category, item.bodyType, item.vehicleType),
    priceEur: intFrom(
      pick(item.price?.consumerPriceGross, item.priceValue, item.price, item.priceEur, item.grossPrice)
    ),
    displacementCm3: intFrom(pick(item.cubicCapacity, item.displacement, item.engineSize)),
    powerKw: intFrom(pick(item.powerKw, item.power, item.kw)),
    co2GKm: intFrom(pick(item.co2, item.co2Emissions, item.co2GKm)),
    emissionStandard: emission.standard,
    emissionStandardInferred: emission.inferred,
    location: {
      zip: pick(item.seller?.zipcode, item.zipCode, item.zip, item.postalCode),
      country: pick(item.seller?.countryCode, item.country, 'DE'),
    },
    thumbnailUrl: Array.isArray(images)
      ? pick(images[0]?.uri, images[0]?.url, images[0])
      : pick(images?.uri, images?.url, item.imageUrl, item.thumbnailUrl),
    url: pick(item.url, item.detailPageUrl, item.detailUrl, item.link),
    ageYears: year != null ? Math.max(0, referenceYear - year) : null,
  };
}
