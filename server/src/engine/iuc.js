// IUC — Imposto Único de Circulação (annual road tax), Categoria B.
//
// Shown separately to the user as an ongoing-ownership figure; NOT added to the
// one-time landed cost (PLAN.md §4.2). IUC is an annual figure shown alongside
// the import cost, never folded into it.
//
// Categoria B = light passenger / mixed-use vehicles first registered after
// 1 July 2007. For imported used cars the base year is the original
// registration year in the country of origin (rule since 2020).
//
// Exact statutory tables — OE2026 (Lei n.º 73-A/2025), unchanged from 2024/2025.
// Like the ISV tables in isvTables.js these are STATUTORY: replace once a year
// per the OE, never estimate. Authoritative source: Código do IUC (arts. 7/10)
// + Portal das Finanças. Worked example cross-check (Repsol/Montepio): a 2020
// diesel, 1968 cm³, 120 g/km NEDC ⇒ (127.35 + 65.15) × 1.15 + 20.12 = 241.49 €.
//
// Formula (Categoria B):
//   IUC = (cilindrada + CO₂ + adicionalCO₂) × coefAno  +  adicionalGasóleo
//
// The CO₂ component and its 2017+ surcharge use different g/km brackets for
// NEDC vs WLTP figures (same euro amounts); the diesel surcharge is added AFTER
// the year-coefficient multiplication, never multiplied by it.

import { normaliseFuel } from './isv.js';

const round2 = (n) => Math.round(n * 100) / 100;

// Componente cilindrada (€), by engine displacement.
function cylinderTax(cm3) {
  if (cm3 <= 1250) return 31.77;
  if (cm3 <= 1750) return 63.74;
  if (cm3 <= 2500) return 127.35;
  return 435.84;
}

// CO₂ brackets differ by homologation standard; the euro values are shared.
const CO2_THRESHOLDS = { NEDC: [120, 180, 250], WLTP: [140, 205, 260] };
const CO2_VALUES = [65.15, 97.63, 212.04, 363.25];

// Componente CO₂ (€).
function co2Tax(co2GKm, standard) {
  const t = CO2_THRESHOLDS[standard] ?? CO2_THRESHOLDS.WLTP;
  if (co2GKm <= t[0]) return CO2_VALUES[0];
  if (co2GKm <= t[1]) return CO2_VALUES[1];
  if (co2GKm <= t[2]) return CO2_VALUES[2];
  return CO2_VALUES[3];
}

// Taxa adicional CO₂ (€) — applies only to vehicles first registered from 2017.
function additionalCo2Tax(co2GKm, standard, firstRegYear) {
  if (firstRegYear < 2017) return 0;
  const t = CO2_THRESHOLDS[standard] ?? CO2_THRESHOLDS.WLTP;
  if (co2GKm <= t[1]) return 0; // ≤180 NEDC / ≤205 WLTP
  if (co2GKm <= t[2]) return 31.77; // 181–250 / 206–260
  return 63.74; // >250 / >260
}

// Coeficiente por ano de primeira matrícula (Categoria B starts 1 Jul 2007).
function yearCoefficient(firstRegYear) {
  if (firstRegYear >= 2010) return 1.15;
  if (firstRegYear === 2009) return 1.1;
  if (firstRegYear === 2008) return 1.05;
  return 1.0; // 2007
}

// Adicional gasóleo (€) — diesel only, by engine displacement.
function dieselSurcharge(cm3) {
  if (cm3 <= 1250) return 5.02;
  if (cm3 <= 1750) return 10.07;
  if (cm3 <= 2500) return 20.12;
  return 68.85;
}

/**
 * Exact Categoria B IUC for a vehicle first registered after 1 July 2007.
 *
 * @param {object} v
 * @param {number} v.displacementCm3
 * @param {number} v.co2GKm
 * @param {number} v.firstRegYear        Original registration year (country of origin)
 * @param {string} [v.fuelType]
 * @param {('WLTP'|'NEDC')} [v.emissionStandard]  Which CO₂ brackets apply (default WLTP)
 * @returns {{ annualIucEur: number, breakdown: object, isExact: true }}
 */
export function calculateIUC(v) {
  const {
    displacementCm3,
    co2GKm,
    firstRegYear,
    fuelType,
    emissionStandard = 'WLTP',
  } = v;
  const fuel = normaliseFuel(fuelType);

  // Pure electric vehicles are exempt from IUC (Categoria B).
  if (fuel === 'electric') {
    return {
      annualIucEur: 0,
      breakdown: { exempt: true, reason: 'electric' },
      isExact: true,
    };
  }

  const cylinder = cylinderTax(displacementCm3);
  const co2 = co2Tax(co2GKm, emissionStandard);
  const additionalCo2 = additionalCo2Tax(co2GKm, emissionStandard, firstRegYear);
  const coefficient = yearCoefficient(firstRegYear);
  const diesel = fuel === 'diesel' ? dieselSurcharge(displacementCm3) : 0;

  const annualIucEur = round2(
    (cylinder + co2 + additionalCo2) * coefficient + diesel
  );

  return {
    annualIucEur,
    breakdown: {
      exempt: false,
      cylinderEur: cylinder,
      co2Eur: co2,
      additionalCo2Eur: additionalCo2,
      yearCoefficient: coefficient,
      dieselSurchargeEur: diesel,
      emissionStandard,
    },
    isExact: true,
  };
}
