import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLandedCost, attachComparison } from '../src/engine/landedCost.js';

const round2 = (n) => Math.round(n * 100) / 100;

const CONFIG = {
  byKey: {
    'transport.open_carrier': {
      key: 'transport.open_carrier',
      label: 'Open carrier',
      category: 'transport',
      amount_eur: 600,
      enabled: true,
    },
    'fee.dua': { key: 'fee.dua', label: 'DUA', category: 'legalisation', amount_eur: 65, enabled: true },
  },
  activeTransportMethod: 'transport.open_carrier',
};

const baseListing = {
  brand: 'BMW',
  model: '320d',
  fuelType: 'Diesel',
  displacementCm3: 1995,
  co2GKm: 120,
  emissionStandard: 'WLTP',
  ageYears: 5,
  firstRegYear: 2019,
  mileageKm: 90000,
  priceEur: 20000,
};

test('a normal used car gets no VAT and the standard total', () => {
  const r = computeLandedCost(baseListing, CONFIG);
  assert.equal(r.incomplete, false);
  assert.equal(r.breakdown.vat.applicable, false);
  const expected = round2(20000 + r.breakdown.isv.isv + 600 + 65);
  assert.equal(r.totalLandedCostEur, expected);
});

test('a nearly-new car adds 23% IVA to the landed cost', () => {
  const r = computeLandedCost({ ...baseListing, mileageKm: 3000, ageYears: 1 }, CONFIG);
  assert.equal(r.breakdown.vat.applicable, true);
  assert.equal(r.breakdown.vat.vatEur, 4600);
  const expected = round2(20000 + r.breakdown.isv.isv + 600 + 65 + 4600);
  assert.equal(r.totalLandedCostEur, expected);
});

test('attachComparison uses the robust market value for the saving', () => {
  const r = computeLandedCost(baseListing, CONFIG);
  const withCmp = attachComparison(r, { marketValueEur: 30000, avgPriceEur: 31000 });
  // Saving is vs marketValueEur (30000), not the mean (31000).
  assert.equal(withCmp.savingEur, round2(30000 - r.totalLandedCostEur));
});

test('attachComparison adds an expected resale margin when a haircut is set', () => {
  const r = computeLandedCost(baseListing, CONFIG);
  const withCmp = attachComparison(r, { marketValueEur: 30000 }, { resaleHaircutPct: 10 });
  assert.equal(withCmp.estimatedResaleEur, 27000); // 30000 − 10%
  assert.equal(withCmp.marginEur, round2(27000 - r.totalLandedCostEur));
  assert.equal(withCmp.resaleHaircutPct, 10);
});

test('an incomplete result carries no saving/margin', () => {
  const r = computeLandedCost({ ...baseListing, co2GKm: null }, CONFIG);
  assert.equal(r.incomplete, true);
  const withCmp = attachComparison(r, { marketValueEur: 30000 }, { resaleHaircutPct: 10 });
  assert.equal(withCmp.savingEur, null);
  assert.equal(withCmp.marginEur, null);
});
