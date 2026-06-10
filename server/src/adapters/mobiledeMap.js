// Pure mapping between the mobile.de Search API and our normalised listing
// shape (the shape `computeLandedCost` consumes). No I/O — kept separate from
// the HTTP client so it can be unit-tested against recorded response fixtures.
//
// mobile.de Search API reference (services.mobile.de/docs/search-api.html):
//   ad fields: mobileAdId, mileage, firstRegistration (yyyyMM), fuel, gearbox,
//   cubicCapacity (ccm), power (kW), co2 (g/km), price.consumerPriceGross (EUR),
//   detailPageUrl, seller, images.

// mobile.de fuel enum → the free-form strings our ISV engine's normaliseFuel
// already understands.
const FUEL_MAP = {
  PETROL: 'Petrol',
  DIESEL: 'Diesel',
  ELECTRICITY: 'Electric',
  HYBRID: 'Hybrid',
  HYBRID_PLUGIN: 'PHEV',
  LPG: 'LPG',
  CNG: 'CNG',
  ETHANOL: 'Petrol',
  HYDROGENIUM: 'Electric',
};

const GEARBOX_MAP = {
  MANUAL_GEAR: 'Manual',
  AUTOMATIC_GEAR: 'Automatic',
  SEMIAUTOMATIC_GEAR: 'Automatic',
};

/** Parse mobile.de `firstRegistration` ("yyyyMM" or "yyyy-MM") → { year, month }. */
export function parseFirstRegistration(value) {
  if (value == null) return { year: null, month: null };
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 4) return { year: null, month: null };
  return {
    year: Number(digits.slice(0, 4)),
    month: digits.length >= 6 ? Number(digits.slice(4, 6)) : null,
  };
}

/**
 * Infer the emission-test standard from the first-registration year.
 *
 * mobile.de does not return whether CO₂ is NEDC or WLTP, but WLTP became
 * mandatory for newly registered passenger cars from September 2018, so cars
 * registered 2019+ are effectively WLTP. This is an assumption the user should
 * be able to override in the UI (PLAN.md §4 explicitly calls for prompting when
 * the standard is unknown).
 *
 * @returns {{ standard: 'WLTP'|'NEDC', inferred: true }}
 */
export function inferEmissionStandard(firstRegYear) {
  const standard = firstRegYear != null && firstRegYear >= 2019 ? 'WLTP' : 'NEDC';
  return { standard, inferred: true };
}

const num = (v) => (v == null || v === '' ? null : Number(v));

/**
 * Map a single mobile.de ad → our normalised listing.
 *
 * @param {object} ad           a mobile.de Search API ad object
 * @param {number} referenceYear  year used to derive `ageYears` (default: caller passes current year)
 * @returns {object} normalised listing
 */
export function mapAd(ad, referenceYear) {
  const { year, month } = parseFirstRegistration(ad.firstRegistration);
  const fuelRaw = ad.fuel ?? ad.fuelType ?? '';
  const emission = inferEmissionStandard(year);

  const priceEur =
    num(ad.price?.consumerPriceGross) ??
    num(ad.price?.gross) ??
    num(ad.price?.amount) ??
    null;

  const images = ad.images ?? ad.image ?? [];
  const thumbnailUrl = Array.isArray(images)
    ? images[0]?.uri ?? images[0]?.url ?? images[0] ?? null
    : images?.uri ?? images?.url ?? null;

  return {
    id: String(ad.mobileAdId ?? ad.id ?? ''),
    brand: ad.make ?? ad.makeName ?? null,
    model: ad.model ?? ad.modelName ?? ad.modelDescription ?? null,
    year,
    firstRegYear: year,
    firstRegMonth: month,
    mileageKm: num(ad.mileage),
    fuelType: FUEL_MAP[String(fuelRaw).toUpperCase()] ?? fuelRaw ?? null,
    transmission: GEARBOX_MAP[String(ad.gearbox ?? '').toUpperCase()] ?? ad.gearbox ?? null,
    bodyType: ad.category ?? ad.bodyType ?? null,
    priceEur,
    displacementCm3: num(ad.cubicCapacity),
    powerKw: num(ad.power),
    co2GKm: num(ad.co2),
    emissionStandard: emission.standard,
    emissionStandardInferred: emission.inferred,
    location: { zip: ad.seller?.zipcode ?? null, country: ad.seller?.countryCode ?? 'DE' },
    thumbnailUrl,
    url: ad.detailPageUrl ?? ad.detailPage?.url ?? null,
    ageYears: year != null ? Math.max(0, referenceYear - year) : null,
  };
}

/**
 * Map our search filters → mobile.de Search API query params.
 *
 * @param {object} filters       see PLAN.md §3
 * @param {object} [classification]  optional refdata path for make/model, e.g.
 *   "refdata/classes/Car/makes/BMW/models/3ER" (resolved by the client)
 * @returns {URLSearchParams}
 */
export function buildSearchParams(filters = {}, classification = null) {
  const p = new URLSearchParams();
  p.set('country', 'DE');
  p.set('condition', 'USED');

  if (classification) p.set('classification', classification);
  if (filters.priceMin != null) p.set('price.min', String(filters.priceMin));
  if (filters.priceMax != null) p.set('price.max', String(filters.priceMax));
  if (filters.yearFrom != null) p.set('firstRegistrationDate.min', `${filters.yearFrom}-01`);
  if (filters.maxMileageKm != null) p.set('mileage.max', String(filters.maxMileageKm));

  // Fuel: mobile.de takes repeated `fuel` params using its own enum values.
  // Several enum values share a normalised label (PETROL/ETHANOL → "Petrol");
  // keep the FIRST (canonical) enum for each label rather than the last.
  const reverseFuel = {};
  for (const [enumVal, label] of Object.entries(FUEL_MAP)) {
    const k = label.toLowerCase();
    if (!(k in reverseFuel)) reverseFuel[k] = enumVal;
  }
  for (const f of filters.fuelTypes ?? []) {
    const enumVal = reverseFuel[String(f).toLowerCase()];
    if (enumVal) p.append('fuel', enumVal);
  }

  if (filters.transmission && filters.transmission.toLowerCase() !== 'any') {
    const gb = filters.transmission.toLowerCase() === 'manual' ? 'MANUAL_GEAR' : 'AUTOMATIC_GEAR';
    p.set('gearbox', gb);
  }

  return p;
}
