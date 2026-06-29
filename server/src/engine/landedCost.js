// Landed-cost composer. See PLAN.md §4.5.
//
//   Total landed cost = German price + ISV + Transport + Legalisation fees
//
// Every component must resolve to a REAL computed or configured value. If any
// required config value is missing, the result is marked `incomplete` (with the
// missing fields listed) rather than silently estimated.

import { calculateISV, normaliseFuel } from './isv.js';
import { calculateIUC } from './iuc.js';
import { assessVat } from './vat.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The listing-level fields the ISV calculation needs but a listing can lack
 * (a combustion car with no published CO₂/displacement). Returns the missing
 * field names (prefixed `listing.`) — empty when the car is fully costable.
 *
 * Shared so the batch ingestor (jobs/ingestDeals.js) and `computeLandedCost`
 * agree on what "complete" means: an EV needs neither; a combustion car needs
 * both. Used to drive enrichment tracking (a missing field is something a
 * detail-page fetch might still fill — see the enrich-status flow).
 *
 * @param {object} listing  normalised listing
 * @returns {string[]} e.g. ['listing.displacementCm3', 'listing.co2GKm']
 */
export function missingListingFields(listing) {
  const combustion = normaliseFuel(listing.fuelType) !== 'electric';
  const missing = [];
  if (combustion && listing.displacementCm3 == null) missing.push('listing.displacementCm3');
  if (combustion && listing.co2GKm == null) missing.push('listing.co2GKm');
  return missing;
}

/**
 * Tax inputs that a *detail-page* fetch can still fill but which a listing can be
 * "complete" (costable) without — they refine the ISV rather than block it:
 *
 *   - diesel particle emissions → the €500 particulate surcharge (CISV). Without
 *     it the surcharge is silently omitted, UNDER-stating a non-DPF diesel's ISV.
 *   - PHEV electric range → the reduced (25%) ISV regime. Without it a qualifying
 *     plug-in is taxed at the full rate, OVER-stating its ISV ~4×.
 *
 * Returned so the enrichment layer fetches the detail page for these cars even
 * when CO₂/displacement already came off the search card (which would otherwise
 * short-circuit enrichment). Kept SEPARATE from missingListingFields so a missing
 * refinement never marks a result `incomplete`. Empty ⇒ no detail fetch needed.
 *
 * @param {object} listing  normalised listing
 * @returns {string[]} e.g. ['listing.particleEmissionsGKm']
 */
export function missingTaxRefinements(listing) {
  const fuel = normaliseFuel(listing.fuelType);
  const missing = [];
  if (fuel === 'diesel' && listing.particleEmissionsGKm == null)
    missing.push('listing.particleEmissionsGKm');
  if (fuel === 'phev' && listing.electricRangeKm == null)
    missing.push('listing.electricRangeKm');
  return missing;
}

/**
 * @param {object} listing            Normalised mobile.de listing
 * @param {object} config             Result of buildConfigView() from db layer:
 *   @param {object} config.byKey       cost_config rows keyed by `key`
 *   @param {string} config.activeTransportMethod  e.g. 'transport.enclosed'
 * @param {object} [opts]              { referenceYear, referenceMonth } — "now",
 *   used only to sharpen the ≤6-month VAT test when the listing has a reg month.
 *   `emissionStandard` ('WLTP'|'NEDC') overrides the listing's inferred standard
 *   (the UI lets the user confirm which one PT customs would apply).
 * @returns {object} enriched result with cost breakdown + completeness flag
 */
export function computeLandedCost(listing, config, opts = {}) {
  const { byKey, activeTransportMethod } = config;
  const missing = [];

  // The user-confirmed standard wins over the listing's inferred one; default WLTP.
  const emissionStandard = opts.emissionStandard ?? listing.emissionStandard ?? 'WLTP';

  // --- ISV (real, computed) ---
  // Live-scraped listings can lack CO₂/displacement; computing the tables with
  // null inputs silently yields a wrong (negative-environmental) ISV, so mark
  // the result incomplete instead of estimating.
  const combustion = normaliseFuel(listing.fuelType) !== 'electric';
  missing.push(...missingListingFields(listing));

  const isv =
    combustion && (listing.displacementCm3 == null || listing.co2GKm == null)
      ? {
          fuel: normaliseFuel(listing.fuelType),
          exempt: false,
          unavailable: true,
          specialRegime: 'none',
          emissionStandard,
          cylinderComponent: null,
          environmentalComponent: null,
          ageReductionRate: 0,
          baseISV: null,
          dieselSurcharge: 0,
          isv: null,
          notes: ['Listing does not publish CO₂ and/or displacement — ISV cannot be computed.'],
        }
      : calculateISV({
          displacementCm3: listing.displacementCm3,
          co2GKm: listing.co2GKm,
          fuelType: listing.fuelType,
          emissionStandard,
          ageYears: listing.ageYears,
          qualifiesForEvRegime: listing.qualifiesForEvRegime ?? false,
          particleEmissionsGKm: listing.particleEmissionsGKm,
        });

  // --- Transport (real, configured) ---
  let transport = { method: activeTransportMethod, amountEur: null, label: null };
  const transportRow = activeTransportMethod ? byKey[activeTransportMethod] : null;
  if (!activeTransportMethod) {
    missing.push('transport.active_method');
  } else if (!transportRow || !transportRow.enabled) {
    missing.push(activeTransportMethod);
  } else {
    transport = {
      method: activeTransportMethod,
      label: transportRow.label,
      amountEur: transportRow.amount_eur,
    };
  }

  // --- Legalisation fees (sum of enabled, configured line items) ---
  const legalisationItems = Object.values(byKey)
    .filter((r) => r.category === 'legalisation' && r.enabled)
    .map((r) => ({ key: r.key, label: r.label, amountEur: r.amount_eur }));
  const legalisationTotal = round2(
    legalisationItems.reduce((sum, i) => sum + i.amountEur, 0)
  );

  // At least one enabled legalisation fee is required for a complete result.
  if (legalisationItems.length === 0) {
    missing.push('legalisation.*');
  }

  // --- IUC (annual, shown separately — never added to the total) ---
  const iuc = calculateIUC({
    displacementCm3: listing.displacementCm3,
    co2GKm: listing.co2GKm,
    firstRegYear: listing.firstRegYear,
    fuelType: listing.fuelType,
    emissionStandard,
  });

  // --- VAT (IVA) on nearly-new imports (PLAN.md §10 — intra-EU correctness) ---
  // A "new means of transport" (≤6 months or ≤6,000 km) owes 23% PT IVA on top
  // of ISV. Added to the total only when (near-)certain; a "suspect" case warns
  // without inventing a number (see vat.js).
  const vat = assessVat({
    mileageKm: listing.mileageKm,
    ageYears: listing.ageYears,
    firstRegYear: listing.firstRegYear,
    firstRegMonth: listing.firstRegMonth,
    priceEur: listing.priceEur,
    referenceYear: opts.referenceYear,
    referenceMonth: opts.referenceMonth,
  });
  const vatAdd = vat.applicable && vat.vatEur != null ? vat.vatEur : 0;

  const incomplete = missing.length > 0;

  const totalLandedCost = incomplete
    ? null
    : round2(
        listing.priceEur + isv.isv + transport.amountEur + legalisationTotal + vatAdd
      );

  return {
    listing,
    breakdown: {
      germanPriceEur: listing.priceEur,
      isv,
      transport,
      legalisation: { items: legalisationItems, totalEur: legalisationTotal },
      vat,
      iuc,
    },
    totalLandedCostEur: totalLandedCost,
    incomplete,
    missingConfig: missing,
  };
}

/**
 * Attach a PT-market comparison and a saving/margin verdict to a computed
 * result (PLAN.md §5). The verdict is taken against the comparison's robust
 * `marketValueEur` (mileage-regression/median) when present, else the mean.
 *
 * `savingEur` is vs the PT *asking* benchmark. When a resale haircut is
 * configured (`opts.resaleHaircutPct`), an `estimatedResaleEur` and the real
 * `marginEur`/`marginPct` (what you'd actually clear after selling below asking)
 * are added alongside — asking ≠ sale price.
 *
 * @param {object} result      computeLandedCost() output
 * @param {object} comparison  PT-market comparison
 * @param {object} [opts]      { resaleHaircutPct }
 */
export function attachComparison(result, comparison, opts = {}) {
  const ref = comparison ? comparison.marketValueEur ?? comparison.avgPriceEur : null;
  // An explicitly-unreliable comparison (e.g. no model to match on — see
  // ptMarketClient.finalizeComparison) is attached for transparency but must NOT
  // produce a saving/verdict: a brand-only match is not a real benchmark.
  const unreliable = comparison?.reliable === false;
  if (result.incomplete || !comparison || ref == null || unreliable) {
    return {
      ...result,
      comparison: comparison ?? null,
      savingEur: null,
      savingPct: null,
      marginEur: null,
      marginPct: null,
      estimatedResaleEur: null,
      confidence: comparison?.confidence ?? null,
    };
  }
  const savingEur = round2(ref - result.totalLandedCostEur);
  const savingPct = round2((savingEur / ref) * 100);

  const haircutPct = Number(opts.resaleHaircutPct) || 0;
  let estimatedResaleEur = null;
  let marginEur = null;
  let marginPct = null;
  if (haircutPct > 0) {
    estimatedResaleEur = round2(ref * (1 - haircutPct / 100));
    marginEur = round2(estimatedResaleEur - result.totalLandedCostEur);
    marginPct =
      estimatedResaleEur > 0 ? round2((marginEur / estimatedResaleEur) * 100) : null;
  }

  return {
    ...result,
    comparison,
    savingEur,
    savingPct,
    estimatedResaleEur,
    marginEur,
    marginPct,
    resaleHaircutPct: haircutPct || null,
    // Surfaced at result level so the badge/caution layer can temper a saving that
    // rests on a weak benchmark (small/dispersed/model-only sample) — see
    // ptMarketClient.gradeConfidence. Null when the comparison didn't grade it.
    confidence: comparison.confidence ?? null,
  };
}
