// Landed-cost composer. See PLAN.md §4.5.
//
//   Total landed cost = German price + ISV + Transport + Legalisation fees
//
// Every component must resolve to a REAL computed or configured value. If any
// required config value is missing, the result is marked `incomplete` (with the
// missing fields listed) rather than silently estimated.

import { calculateISV, normaliseFuel } from './isv.js';
import { estimateIUC } from './iuc.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} listing            Normalised mobile.de listing
 * @param {object} config             Result of buildConfigView() from db layer:
 *   @param {object} config.byKey       cost_config rows keyed by `key`
 *   @param {string} config.activeTransportMethod  e.g. 'transport.enclosed'
 * @returns {object} enriched result with cost breakdown + completeness flag
 */
export function computeLandedCost(listing, config) {
  const { byKey, activeTransportMethod } = config;
  const missing = [];

  // --- ISV (real, computed) ---
  // Live-scraped listings can lack CO₂/displacement; computing the tables with
  // null inputs silently yields a wrong (negative-environmental) ISV, so mark
  // the result incomplete instead of estimating.
  const combustion = normaliseFuel(listing.fuelType) !== 'electric';
  if (combustion && listing.displacementCm3 == null) missing.push('listing.displacementCm3');
  if (combustion && listing.co2GKm == null) missing.push('listing.co2GKm');

  const isv =
    combustion && (listing.displacementCm3 == null || listing.co2GKm == null)
      ? {
          fuel: normaliseFuel(listing.fuelType),
          exempt: false,
          unavailable: true,
          specialRegime: 'none',
          emissionStandard: listing.emissionStandard ?? 'WLTP',
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
          emissionStandard: listing.emissionStandard ?? 'WLTP',
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
  const iuc = estimateIUC({
    displacementCm3: listing.displacementCm3,
    co2GKm: listing.co2GKm,
    firstRegYear: listing.firstRegYear,
    fuelType: listing.fuelType,
  });

  const incomplete = missing.length > 0;

  const totalLandedCost = incomplete
    ? null
    : round2(
        listing.priceEur + isv.isv + transport.amountEur + legalisationTotal
      );

  return {
    listing,
    breakdown: {
      germanPriceEur: listing.priceEur,
      isv,
      transport,
      legalisation: { items: legalisationItems, totalEur: legalisationTotal },
      iuc,
    },
    totalLandedCostEur: totalLandedCost,
    incomplete,
    missingConfig: missing,
  };
}

/**
 * Attach a PT-market comparison and a saving/premium verdict to a computed
 * result. Comparison values come from the PT-market adapter (PLAN.md §5).
 */
export function attachComparison(result, comparison) {
  if (result.incomplete || !comparison || comparison.avgPriceEur == null) {
    return { ...result, comparison: comparison ?? null, savingEur: null, savingPct: null };
  }
  const savingEur = round2(comparison.avgPriceEur - result.totalLandedCostEur);
  const savingPct = round2((savingEur / comparison.avgPriceEur) * 100);
  return { ...result, comparison, savingEur, savingPct };
}
