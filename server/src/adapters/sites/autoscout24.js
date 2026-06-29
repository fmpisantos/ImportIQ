// AutoScout24 site adapter for the Apify path.
//
// Default actor: automation-lab/autoscout24-scraper — pure HTTP+JSON, billed
// per result, and accepts structured filters (make/model/country/price/year/
// fuel/maxListings) or a startUrls passthrough. make/model are lowercase slugs.

import { proxyInput } from '../apifyClient.js';
import {
  pick,
  intFrom,
  canonicalFuel,
  canonicalTransmission,
  parseYear,
  inferEmissionStandard,
  slugify,
} from '../normalize.js';
import { classifyTrim } from '../../engine/trim.js';

export const key = 'autoscout24';
export const label = 'AutoScout24';

/**
 * @param {object} filters
 * @param {object} cfg  { actorId, maxResults, country, startUrls? }
 */
export function buildInput(filters = {}, cfg = {}) {
  const input = {
    maxListings: cfg.maxResults ?? 50,
    country: cfg.country ?? 'D', // AutoScout24 country code; 'D' = Germany
    proxyConfiguration: proxyInput(),
  };

  if (Array.isArray(cfg.startUrls) && cfg.startUrls.length) {
    input.startUrls = cfg.startUrls.map((url) => ({ url }));
    return input;
  }

  if (filters.brand) input.make = slugify(filters.brand);
  if (filters.model) input.model = slugify(filters.model);
  if (filters.priceMin != null) input.priceFrom = filters.priceMin;
  if (filters.priceMax != null) input.priceTo = filters.priceMax;
  if (filters.yearFrom != null) input.yearFrom = filters.yearFrom;
  if (Array.isArray(filters.fuelTypes) && filters.fuelTypes.length) {
    input.fuelType = filters.fuelTypes[0];
  }
  return input;
}

export function mapItem(item = {}, referenceYear) {
  const year =
    parseYear(pick(item.firstRegistration, item.registrationDate, item.year, item.firstReg)) ?? null;
  const emission = inferEmissionStandard(year);
  const images = item.images ?? item.imageUrls ?? [];

  return {
    id: String(pick(item.id, item.guid, item.url, item.detailUrl, '')),
    brand: pick(item.make, item.makeName, item.brand, item.manufacturer),
    model: pick(item.model, item.modelName, item.modelOrModelLine),
    year,
    firstRegYear: year,
    firstRegMonth: null,
    mileageKm: intFrom(pick(item.mileage, item.mileageKm, item.km)),
    fuelType: canonicalFuel(pick(item.fuel, item.fuelType, item.fuelCategory)),
    transmission: canonicalTransmission(pick(item.transmission, item.gearbox, item.transmissionType)),
    bodyType: pick(item.bodyType, item.category, item.vehicleType),
    variant: pick(item.version, item.modelOrModelLine, null),
    trimTier: classifyTrim(
      [item.version, item.modelOrModelLine, item.model, item.modelName].filter(Boolean).join(' ')
    ).tier,
    priceEur: intFrom(pick(item.price, item.priceValue, item.priceEur, item.rawPrice)),
    displacementCm3: intFrom(pick(item.displacement, item.cubicCapacity, item.engineSize)),
    powerKw: intFrom(pick(item.powerKw, item.kw, item.power)),
    co2GKm: intFrom(pick(item.co2Emissions, item.co2, item.co2GKm)),
    emissionStandard: emission.standard,
    emissionStandardInferred: emission.inferred,
    location: {
      zip: pick(item.zip, item.zipCode, item.location?.zip, item.postalCode),
      country: pick(item.country, item.location?.country, item.countryCode, 'DE'),
    },
    thumbnailUrl: Array.isArray(images)
      ? pick(images[0]?.url, images[0])
      : pick(item.imageUrl, item.image, item.thumbnailUrl),
    url: pick(item.url, item.detailUrl, item.link, item.detailPageUrl),
    ageYears: year != null ? Math.max(0, referenceYear - year) : null,
  };
}
