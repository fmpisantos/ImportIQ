import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, comparisonCriteria } from '../src/adapters/ptMarketClient.js';

test('comparisonCriteria builds the PLAN §5 window (year ±1, mileage ±20k)', () => {
  const c = comparisonCriteria({ brand: 'BMW', model: '320i', year: 2019, mileageKm: 64000 });
  assert.deepEqual(c.yearRange, [2018, 2020]);
  assert.deepEqual(c.mileageRangeKm, [44000, 84000]);
});

test('summarise averages valid prices and counts the sample', () => {
  const out = summarise(
    [{ priceEur: 20000 }, { priceEur: 22000 }, { price: 24000 }],
    'official:olx',
    {}
  );
  assert.equal(out.avgPriceEur, 22000);
  assert.equal(out.sampleSize, 3);
  assert.equal(out.source, 'official:olx');
});

test('summarise ignores zero/invalid prices', () => {
  const out = summarise([{ priceEur: 0 }, { priceEur: null }, { priceEur: 18000 }], 'x', {});
  assert.equal(out.avgPriceEur, 18000);
  assert.equal(out.sampleSize, 1);
});

test('summarise returns null average for an empty set', () => {
  const out = summarise([], 'x', {});
  assert.equal(out.avgPriceEur, null);
  assert.equal(out.sampleSize, 0);
});
