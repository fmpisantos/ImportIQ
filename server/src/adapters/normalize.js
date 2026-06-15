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

/**
 * Parse the FIRST number out of a spec string, stopping at the unit — so a unit
 * that ends in a digit doesn't get glued on: "1.995 cm³" → 1995, "1995 cm3" →
 * 1995 (NOT 19953), "116 cv" → 116. Thousands separators (., space, ') inside
 * the leading run are stripped. Use for engine power/displacement where intFrom
 * (which concatenates every digit in the string) would mis-read the unit. Pure.
 */
export function leadingInt(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const m = String(value).match(/\d[\d.\s']*/);
  if (!m) return null;
  const digits = m[0].replace(/[.\s']/g, '');
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip diacritics so localized labels match the keyword tables — without this,
 * PT "Automática"/"Elétrico"/"Híbrido" never matched their English/German
 * patterns and every such comparable was wrongly dropped (the no-PT-average
 * bug). NFD-decompose, then remove combining marks.
 */
const deaccent = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

const FUEL_KEYWORDS = [
  // order matters: check the more specific labels first. Patterns run against
  // the de-accented label, so e.g. "elétrico" → "eletrico" matches `eletric`.
  ['PHEV', /plug.?in|phev|plug-in-hybrid|hybrid.?plug/i],
  ['Electric', /electric|eletric|elektro|elettric|electr|bev|\bev\b/i],
  ['Hybrid', /hybrid|hibrid|ibrid|hybride/i],
  ['Diesel', /diesel|gasoleo/i],
  ['LPG', /lpg|autogas|gpl|flussiggas/i],
  ['CNG', /\bcng\b|erdgas|metano|natural gas/i],
  ['Petrol', /petrol|gasoline|benzin|benzina|essence|super|gasolina/i],
];

/** Map any free-text / enum fuel label onto our canonical set, else pass through. */
export function canonicalFuel(raw) {
  if (raw == null || raw === '') return null;
  const s = deaccent(raw);
  for (const [label, re] of FUEL_KEYWORDS) {
    if (re.test(s)) return label;
  }
  return String(raw);
}

/** Map any free-text gearbox label → 'Manual' | 'Automatic', else pass through. */
export function canonicalTransmission(raw) {
  if (raw == null || raw === '') return null;
  const s = deaccent(raw); // PT "Automática" → "Automatica"
  if (/manual|schalt|manuale|manuelle|manuell/i.test(s)) return 'Manual';
  // `autom` (not `automat`) so localized labels also match — FR "Automatique",
  // IT/ES "Automatico", DE "Automatik", PT "Automatica" (de-accented).
  if (/autom|dsg|tiptronic|s.?tronic|pdk|cvt|edc|amt/i.test(s)) return 'Automatic';
  return String(raw);
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
 * Infer the emission-test standard from the first-registration date, following
 * the rule Portuguese customs effectively applies when classifying an import:
 * WLTP is the homologation standard for passenger cars first registered from
 * 1 September 2018 (when WLTP became mandatory for all new EU registrations);
 * cars registered before that carry NEDC CO₂ figures.
 *
 * Scraped sites never state which standard a CO₂ figure uses, so this is always
 * `inferred: true` and the UI lets the user override it per listing (PLAN.md §4).
 *
 * @param {number|null} firstRegYear
 * @param {number|null} [firstRegMonth]  1–12 when known; sharpens the 2018 cut-off
 * @returns {{ standard: 'WLTP'|'NEDC', inferred: true }}
 */
export function inferEmissionStandard(firstRegYear, firstRegMonth = null) {
  let standard;
  if (firstRegYear == null) {
    standard = 'NEDC';
  } else if (firstRegYear > 2018) {
    standard = 'WLTP'; // 2019+ is unambiguously WLTP
  } else if (firstRegYear < 2018) {
    standard = 'NEDC';
  } else {
    // 2018 is the transition year — WLTP only from September. With no month we
    // lean NEDC (Jan–Aug covers most of the year); either way it stays inferred.
    standard = firstRegMonth != null && firstRegMonth >= 9 ? 'WLTP' : 'NEDC';
  }
  return { standard, inferred: true };
}

/**
 * Strip a trailing fuel/trim suffix from a numeric model code so it matches the
 * model *family* rather than one variant: "320d" → "320", "116i" → "116",
 * "118d" → "118". Word/letter-led models are left untouched ("Golf", "A4",
 * "Série 3"). Pure. Used by the PT comparison's free-text query and matcher.
 */
export function normalizeModelKey(model) {
  const s = String(model ?? '').trim();
  const m = s.match(/^(\d{2,4})\s*[a-z]{1,3}$/i);
  return m ? m[1] : s;
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
 * Drop obvious cross-source duplicates (the same car listed on two sites).
 * Keys on brand+model+year+price+mileage; first occurrence wins, so order the
 * input by source preference.
 */
export function dedupeListings(listings) {
  const seen = new Set();
  const out = [];
  for (const l of listings) {
    const k = [l.brand, l.model, l.year, l.priceEur, l.mileageKm]
      .map((v) => String(v ?? '').toLowerCase())
      .join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

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
  // Sites name models at different granularities ("A4 Avant" vs "A4", "320" vs
  // "3er") — keep the listing when either name contains the other.
  if (model && listing.model) {
    const lm = norm(listing.model);
    const fm = norm(model);
    if (!lm.includes(fm) && !fm.includes(lm)) return false;
  }
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
