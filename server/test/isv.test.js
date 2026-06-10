import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateISV,
  cylinderComponent,
  environmentalComponent,
  ageReduction,
} from '../src/engine/isv.js';

test('cylinder component matches the PLAN example (1498 cm³)', () => {
  // 1498 × 5.61 − 6194.88 = 2208.90
  assert.equal(cylinderComponent(1498), 2208.9);
});

test('cylinder component picks the right bracket', () => {
  assert.equal(cylinderComponent(900), Math.round((900 * 1.09 - 849.03) * 100) / 100);
  assert.equal(cylinderComponent(1200), Math.round((1200 * 1.18 - 850.69) * 100) / 100);
});

test('environmental component gasoline WLTP', () => {
  // 132 g/km → 121–130? No: 132 falls in 131–145 bracket: 6.38, ded 762.73
  assert.equal(environmentalComponent(132, 'gasoline', 'WLTP'), Math.round((132 * 6.38 - 762.73) * 100) / 100);
});

test('age reduction brackets', () => {
  assert.equal(ageReduction(0), 0);
  assert.equal(ageReduction(1), 0.1);
  assert.equal(ageReduction(5), 0.4);
  assert.equal(ageReduction(10), 0.8);
  assert.equal(ageReduction(25), 0.8);
});

test('electric vehicles are exempt', () => {
  const r = calculateISV({
    displacementCm3: 0,
    co2GKm: 0,
    fuelType: 'Electric',
    ageYears: 3,
  });
  assert.equal(r.exempt, true);
  assert.equal(r.isv, 0);
});

test('full ISV for a petrol car with age reduction', () => {
  const r = calculateISV({
    displacementCm3: 1998,
    co2GKm: 132,
    fuelType: 'Petrol',
    emissionStandard: 'WLTP',
    ageYears: 7, // 60% reduction
  });
  const cyl = cylinderComponent(1998);
  const env = environmentalComponent(132, 'gasoline', 'WLTP');
  const expected = Math.round((cyl + env) * (1 - 0.6) * 100) / 100;
  assert.equal(r.baseISV, expected);
  assert.equal(r.isv, expected);
});

test('qualifying PHEV pays 25% of computed ISV', () => {
  const base = calculateISV({
    displacementCm3: 1991,
    co2GKm: 38,
    fuelType: 'Petrol', // compute the undiscounted base for comparison
    emissionStandard: 'WLTP',
    ageYears: 6,
  });
  const phev = calculateISV({
    displacementCm3: 1991,
    co2GKm: 38,
    fuelType: 'PHEV',
    emissionStandard: 'WLTP',
    ageYears: 6,
    qualifiesForEvRegime: true,
  });
  assert.equal(phev.specialRegime, 'phev_25pct');
  assert.equal(phev.baseISV, Math.round(base.baseISV * 0.25 * 100) / 100);
});

test('minimum ISV of €100 is enforced', () => {
  const r = calculateISV({
    displacementCm3: 900, // small engine → could go negative after deduction
    co2GKm: 90,
    fuelType: 'Petrol',
    emissionStandard: 'NEDC',
    ageYears: 10, // 80% reduction
  });
  assert.ok(r.isv >= 100);
});

test('diesel adds the particle surcharge when emissions ≥ 0.001', () => {
  const r = calculateISV({
    displacementCm3: 1968,
    co2GKm: 118,
    fuelType: 'Diesel',
    emissionStandard: 'WLTP',
    ageYears: 5,
    particleEmissionsGKm: 0.002,
  });
  assert.equal(r.dieselSurcharge, 500);
});
