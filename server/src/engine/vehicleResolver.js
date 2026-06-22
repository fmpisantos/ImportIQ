// Resolve a listing's free-text brand+model to the canonical catalog identity,
// using the same fuzzy matcher that backs the Matcher test bench
// (engine/vehicleMatch.js). The PT market comparison uses the result so it
// searches Portugal for the *same car* the card shows — under one consistent
// brand+model rather than whatever spelling the German source happened to use.
//
// A match is only trusted above MIN_RESOLVE_SCORE; below it we return null and
// the caller keeps the raw listing strings (a weak rename is worse than none).

import { buildVehicleIndex, matchVehicle } from './vehicleMatch.js';
import { loadVehicleCatalog } from '../data/vehicleCatalog.loader.js';

// Match score floor for trusting the canonical rename — the matcher's 'medium'
// confidence threshold (see vehicleMatch.js CONFIDENCE). Below this the input is
// too far from any catalog entry to swap the brand/model out from under it.
export const MIN_RESOLVE_SCORE = 0.55;

// The matcher index is built once from the catalog (reference data that only
// changes on reseed/reboot) and reused for every listing — tokenization is the
// per-entry cost, the per-query scan is cheap.
let cachedIndex = null;
export function getVehicleIndex() {
  if (!cachedIndex) cachedIndex = buildVehicleIndex(loadVehicleCatalog().catalog);
  return cachedIndex;
}

// Test seam: drop the memoized index so a test can rebuild from a stub catalog.
export function resetVehicleIndex() {
  cachedIndex = null;
}

/**
 * Resolve free-text brand+model to the canonical catalog identity, or null when
 * nothing matches confidently.
 *
 * @param {string} brand  listing brand (any spelling/typo)
 * @param {string} model  listing model
 * @param {{index?:object, minScore?:number}} [opts]  index override (tests) +
 *        score floor
 * @returns {{brand:string, model:string, submodel:string|null, score:number,
 *            confidence:string}|null}
 */
export function resolveVehicle(brand, model, opts = {}) {
  const query = [brand, model]
    .filter((s) => s != null && String(s).trim())
    .join(' ')
    .trim();
  if (!query) return null;

  const index = opts.index ?? getVehicleIndex();
  const [best] = matchVehicle(query, index, { limit: 1 });
  if (!best || best.score < (opts.minScore ?? MIN_RESOLVE_SCORE)) return null;

  return {
    brand: best.brand,
    model: best.model,
    submodel: best.submodel,
    score: best.score,
    confidence: best.confidence,
  };
}
