// ISV calculation engine — pure, deterministic, no external dependencies.
// Based on the official Portuguese tables in ./isvTables.js. See PLAN.md §4.1.
//
//   ISV = (Cylinder component + Environmental component) × (1 − age_reduction)
//
// then special-regime adjustments and the €100 minimum are applied.

import {
  CYLINDER_BRACKETS,
  AGE_REDUCTION_BRACKETS,
  DIESEL_PARTICLE_SURCHARGE_EUR,
  MINIMUM_ISV_EUR,
} from './isvTables.js';
import { getEnvironmentalBrackets } from './isvTableStore.js';

const round2 = (n) => Math.round(n * 100) / 100;

function firstBracket(brackets, value, key = 'max') {
  return brackets.find((b) => value <= b[key]) ?? brackets[brackets.length - 1];
}

/** Normalise free-form fuel strings to the buckets the tables use. */
export function normaliseFuel(fuel) {
  const f = String(fuel || '').toLowerCase();
  if (f.includes('diesel')) return 'diesel';
  if (f.includes('electric') || f === 'ev' || f === 'bev') return 'electric';
  if (f.includes('phev') || f.includes('plug')) return 'phev';
  if (f.includes('hybrid')) return 'hybrid';
  // petrol, gasoline, lpg, cng all use the gasoline tables
  return 'gasoline';
}

export function cylinderComponent(displacementCm3) {
  const b = firstBracket(CYLINDER_BRACKETS, displacementCm3);
  return round2(displacementCm3 * b.ratePerCm3 - b.deduction);
}

export function environmentalComponent(co2GKm, tableFuel, standard, tables = getEnvironmentalBrackets()) {
  const key = `${tableFuel}.${standard}`;
  const brackets = tables[key];
  if (!brackets) {
    throw new Error(`No environmental table for "${key}"`);
  }
  const b = firstBracket(brackets, co2GKm);
  return round2(co2GKm * b.ratePerGkm - b.deduction);
}

export function ageReduction(ageYears) {
  const b = firstBracket(AGE_REDUCTION_BRACKETS, ageYears, 'maxYears');
  return b.reduction;
}

/**
 * Compute ISV for a single vehicle.
 *
 * @param {object} v
 * @param {number} v.displacementCm3   Engine displacement in cm³
 * @param {number} v.co2GKm            CO₂ emissions in g/km
 * @param {string} v.fuelType          Free-form fuel string (see normaliseFuel)
 * @param {('WLTP'|'NEDC')} v.emissionStandard
 * @param {number} v.ageYears          Full years since first registration
 * @param {('none'|'full_hybrid'|'phev')} [v.hybridType]
 * @param {boolean} [v.qualifiesForEvRegime]  PHEV/full-hybrid meets the range &
 *                                            CO₂ thresholds for the reduced regime
 * @param {number} [v.particleEmissionsGKm]   Diesel particle emissions (g/km)
 * @returns {object} full breakdown
 */
export function calculateISV(v) {
  const {
    displacementCm3,
    co2GKm,
    fuelType,
    emissionStandard = 'WLTP',
    ageYears,
    qualifiesForEvRegime = false,
    particleEmissionsGKm,
  } = v;

  const fuel = normaliseFuel(fuelType);

  // 100% electric — exempt. Short-circuit before any table lookup.
  if (fuel === 'electric') {
    return {
      fuel,
      exempt: true,
      specialRegime: 'electric_exempt',
      cylinderComponent: 0,
      environmentalComponent: 0,
      ageReductionRate: 0,
      baseISV: 0,
      dieselSurcharge: 0,
      isv: 0,
      notes: ['100% electric vehicles are exempt from ISV (€0).'],
    };
  }

  // Gasoline and diesel both use the cylinder + environmental tables. Hybrids
  // are taxed on their combustion engine, then discounted via the regime below.
  const tableFuel = fuel === 'diesel' ? 'diesel' : 'gasoline';

  const cylinder = cylinderComponent(displacementCm3);
  const environmental = environmentalComponent(co2GKm, tableFuel, emissionStandard);
  const reduction = ageReduction(ageYears);

  let base = round2((cylinder + environmental) * (1 - reduction));

  // Diesel particle surcharge (PLAN.md §4.1). Applied after the age reduction.
  let dieselSurcharge = 0;
  const notes = [];
  if (tableFuel === 'diesel') {
    if (typeof particleEmissionsGKm === 'number') {
      if (particleEmissionsGKm >= 0.001) {
        dieselSurcharge = DIESEL_PARTICLE_SURCHARGE_EUR;
      }
    } else {
      notes.push(
        'Diesel particle emissions unknown — the €500 surcharge may apply if ≥ 0.001 g/km.'
      );
    }
  }

  // Special hybrid regimes (PLAN.md §4.1). Applied to the base ISV.
  let specialRegime = 'none';
  if (fuel === 'phev') {
    if (qualifiesForEvRegime) {
      specialRegime = 'phev_25pct';
      base = round2(base * 0.25);
    } else {
      notes.push(
        'PHEV does not meet the reduced-regime thresholds (range/CO₂) — taxed at the full rate.'
      );
    }
  } else if (fuel === 'hybrid') {
    if (qualifiesForEvRegime) {
      specialRegime = 'full_hybrid_60pct';
      base = round2(base * 0.6); // 40% discount
    }
  }

  let isv = round2(base + dieselSurcharge);

  // Minimum ISV payable for non-exempt vehicles.
  if (isv < MINIMUM_ISV_EUR) {
    isv = MINIMUM_ISV_EUR;
    notes.push(`Minimum ISV of €${MINIMUM_ISV_EUR} applied.`);
  }

  return {
    fuel,
    exempt: false,
    specialRegime,
    emissionStandard,
    cylinderComponent: cylinder,
    environmentalComponent: environmental,
    ageReductionRate: reduction,
    baseISV: base,
    dieselSurcharge,
    isv,
    notes,
  };
}
