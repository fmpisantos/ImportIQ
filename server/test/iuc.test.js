import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateIUC } from '../src/engine/iuc.js';

// Authoritative worked example (Repsol/Montepio): 2020 diesel, 1968 cm³,
// 120 g/km NEDC ⇒ (127.35 + 65.15) × 1.15 + 20.12 = 241.49 €.
test('matches the official worked example (diesel, NEDC)', () => {
  const { annualIucEur, breakdown } = calculateIUC({
    displacementCm3: 1968,
    co2GKm: 120,
    firstRegYear: 2020,
    fuelType: 'Diesel',
    emissionStandard: 'NEDC',
  });
  assert.equal(annualIucEur, 241.49);
  assert.equal(breakdown.cylinderEur, 127.35);
  assert.equal(breakdown.co2Eur, 65.15);
  assert.equal(breakdown.additionalCo2Eur, 0);
  assert.equal(breakdown.yearCoefficient, 1.15);
  assert.equal(breakdown.dieselSurchargeEur, 20.12);
});

test('gasoline car has no diesel surcharge', () => {
  // (63.74 + 65.15) × 1.15 = 148.22, no surcharge.
  const { annualIucEur, breakdown } = calculateIUC({
    displacementCm3: 1498,
    co2GKm: 110,
    firstRegYear: 2019,
    fuelType: 'Gasoline',
    emissionStandard: 'NEDC',
  });
  assert.equal(breakdown.dieselSurchargeEur, 0);
  assert.equal(annualIucEur, 148.22);
});

test('NEDC and WLTP use different CO₂ brackets for the same g/km', () => {
  // 140 g/km: NEDC lands in the 121–180 bracket (97.63); WLTP in ≤140 (65.15).
  const base = { displacementCm3: 1600, firstRegYear: 2016, fuelType: 'Gasoline' };
  const nedc = calculateIUC({ ...base, co2GKm: 140, emissionStandard: 'NEDC' });
  const wltp = calculateIUC({ ...base, co2GKm: 140, emissionStandard: 'WLTP' });
  assert.equal(nedc.breakdown.co2Eur, 97.63);
  assert.equal(wltp.breakdown.co2Eur, 65.15);
});

test('additional CO₂ tax applies only from 2017', () => {
  const base = {
    displacementCm3: 2000,
    co2GKm: 200,
    fuelType: 'Gasoline',
    emissionStandard: 'NEDC',
  };
  // 181–250 NEDC ⇒ 31.77 additional, but only for 2017+ registrations.
  assert.equal(calculateIUC({ ...base, firstRegYear: 2016 }).breakdown.additionalCo2Eur, 0);
  assert.equal(calculateIUC({ ...base, firstRegYear: 2017 }).breakdown.additionalCo2Eur, 31.77);
});

test('year coefficient steps 2007→2010+', () => {
  const c = (y) =>
    calculateIUC({
      displacementCm3: 1000,
      co2GKm: 100,
      firstRegYear: y,
      fuelType: 'Gasoline',
    }).breakdown.yearCoefficient;
  assert.equal(c(2007), 1.0);
  assert.equal(c(2008), 1.05);
  assert.equal(c(2009), 1.1);
  assert.equal(c(2010), 1.15);
  assert.equal(c(2024), 1.15);
});

test('electric vehicles are exempt', () => {
  const { annualIucEur, breakdown } = calculateIUC({
    displacementCm3: 0,
    co2GKm: 0,
    firstRegYear: 2022,
    fuelType: 'Electric',
  });
  assert.equal(annualIucEur, 0);
  assert.equal(breakdown.exempt, true);
});
