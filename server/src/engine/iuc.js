// IUC — Imposto Único de Circulação (annual road tax) estimate.
//
// Shown separately to the user as an ongoing-ownership figure; NOT added to the
// one-time landed cost (PLAN.md §4.2). This is an approximation only.
//
// IUC for passenger cars (Categoria B, registered 2007+) combines a cylinder
// component and a CO₂ component, with a coefficient by registration year. For
// imported used cars the base year is the original registration year (2020 rule).
//
// The exact statutory tables are reproduced loosely here as a reasonable
// estimate; the authoritative source is Portal das Finanças.

const round2 = (n) => Math.round(n * 100) / 100;

// Cylinder component (€), Categoria B.
function cylinderTax(displacementCm3) {
  if (displacementCm3 <= 1000) return 31.04;
  if (displacementCm3 <= 1300) return 62.33;
  if (displacementCm3 <= 1750) return 97.64;
  if (displacementCm3 <= 2500) return 167.49;
  return 573.07;
}

// CO₂ component (€), WLTP-ish brackets.
function co2Tax(co2GKm) {
  if (co2GKm <= 120) return 64.82;
  if (co2GKm <= 180) return 97.4;
  if (co2GKm <= 250) return 211.43;
  return 372.16;
}

// Coefficient by first-registration year (newer cars pay a small premium).
function yearCoefficient(firstRegYear) {
  if (firstRegYear >= 2017) return 1.15;
  if (firstRegYear >= 2014) return 1.10;
  if (firstRegYear >= 2010) return 1.05;
  return 1.0;
}

/**
 * @param {object} v
 * @param {number} v.displacementCm3
 * @param {number} v.co2GKm
 * @param {number} v.firstRegYear  Original registration year (country of origin)
 * @param {string} [v.fuelType]
 * @returns {{ annualIucEur: number, isEstimate: true }}
 */
export function estimateIUC(v) {
  const { displacementCm3, co2GKm, firstRegYear, fuelType } = v;
  const f = String(fuelType || '').toLowerCase();

  // Pure electric vehicles pay a nominal/near-zero IUC.
  if (f.includes('electric') || f === 'ev' || f === 'bev') {
    return { annualIucEur: 0, isEstimate: true };
  }

  const cyl = cylinderTax(displacementCm3);
  const co2 = co2Tax(co2GKm);
  const coeff = yearCoefficient(firstRegYear);

  return { annualIucEur: round2((cyl + co2) * coeff), isEstimate: true };
}
