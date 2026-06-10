// Shared, I/O-free helpers for turning messy scraped fields (free-text prices,
// localized fuel labels, "03/2019" dates, …) into the normalised listing shape
// the ISV engine consumes. Used by every Apify site adapter so each only has to
// describe *where* its fields live, not *how* to clean them.

/** First defined, non-empty value among the given candidates. */
export function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/**
 * Parse an integer out of a human/localized number: "12.000 €" → 12000,
 * "120 000 km" → 120000, "1.968 cm³" → 1968, 12000 → 12000. Strips currency,
 * units and thousands separators (., space, ') — we only ever need whole units
 * here, so any decimal tail is dropped rather than misread as a separator.
 */
export function intFrom(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

const FUEL_KEYWORDS = [
  // order matters: check the more specific labels first.
  ['PHEV', /plug.?in|phev|plug-in-hybrid|hybrid.?plug/i],
  ['Electric', /electric|elektro|elettric|électr|bev|\bev\b/i],
  ['Hybrid', /hybrid|hibrid|ibrid|hybride/i],
  ['Diesel', /diesel/i],
  ['LPG', /lpg|autogas|gpl|flüssiggas/i],
  ['CNG', /\bcng\b|erdgas|metano|natural gas/i],
  ['Petrol', /petrol|gasoline|benzin|benzina|essence|super|gasolina/i],
];

/** Map any free-text / enum fuel label onto our canonical set, else pass through. */
export function canonicalFuel(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  for (const [label, re] of FUEL_KEYWORDS) {
    if (re.test(s)) return label;
  }
  return s;
}

/** Map any free-text gearbox label → 'Manual' | 'Automatic', else pass through. */
export function canonicalTransmission(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  if (/manual|schalt|manuale|manuelle|manuell/i.test(s)) return 'Manual';
  if (/automat|dsg|tiptronic|s.?tronic|pdk|cvt/i.test(s)) return 'Automatic';
  return s;
}

/**
 * Pull a 4-digit registration year out of any common shape: 2019, "2019",
 * "03/2019", "2019-03", "2019.03.01", a Date, or an epoch number.
 */
export function parseYear(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && value > 1900 && value < 3000) return value;
  const m = String(value).match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/**
 * Infer the emission-test standard from the registration year. Scraped sites
 * don't say whether a CO₂ figure is NEDC or WLTP; WLTP became mandatory for
 * newly registered cars from Sept 2018, so 2019+ is effectively WLTP. The flag
 * lets the UI surface that this was assumed (PLAN.md §4).
 */
export function inferEmissionStandard(firstRegYear) {
  const standard = firstRegYear != null && firstRegYear >= 2019 ? 'WLTP' : 'NEDC';
  return { standard, inferred: true };
}

/** Lowercase URL/path slug: "Mercedes-Benz" → "mercedes-benz", "A4 Avant" → "a4-avant". */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * Defensive post-filter applied to every source's results, so the listings the
 * user gets back always satisfy their filters — even if a particular actor
 * ignored a parameter or matched it loosely. Listings missing a field aren't
 * dropped for that field (we can't prove they violate it).
 */
export function matchesFilters(listing, filters = {}) {
  const { brand, model, bodyType, priceMin, priceMax, yearFrom, maxMileageKm, transmission } =
    filters;
  const fuelSet =
    Array.isArray(filters.fuelTypes) && filters.fuelTypes.length
      ? new Set(filters.fuelTypes.map(norm))
      : null;

  if (brand && listing.brand && norm(listing.brand) !== norm(brand)) return false;
  if (model && listing.model && !norm(listing.model).includes(norm(model))) return false;
  if (bodyType && listing.bodyType && norm(listing.bodyType) !== norm(bodyType)) return false;
  if (priceMin != null && listing.priceEur != null && listing.priceEur < priceMin) return false;
  if (priceMax != null && listing.priceEur != null && listing.priceEur > priceMax) return false;
  if (yearFrom != null && listing.year != null && listing.year < yearFrom) return false;
  if (maxMileageKm != null && listing.mileageKm != null && listing.mileageKm > maxMileageKm)
    return false;
  if (fuelSet && listing.fuelType && !fuelSet.has(norm(listing.fuelType))) return false;
  if (
    transmission &&
    norm(transmission) !== 'any' &&
    listing.transmission &&
    norm(listing.transmission) !== norm(transmission)
  )
    return false;
  return true;
}
