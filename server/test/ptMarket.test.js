import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarise,
  comparisonCriteria,
  rejectPriceOutliers,
} from '../src/adapters/ptMarketClient.js';

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
  assert.deepEqual(out.sampleListings, []);
});

test('summarise surfaces every priced listing with a URL as sampleListings', () => {
  const listings = Array.from({ length: 8 }, (_, i) => ({
    priceEur: 20000 + i * 1000,
    url: `https://www.olx.pt/d/anuncio/car-${i}.html`,
    title: `Car ${i}`,
  }));
  const out = summarise(listings, 'olx.pt', {});
  assert.equal(out.sampleListings.length, 8);
  assert.deepEqual(out.sampleListings[0], {
    priceEur: 20000,
    url: 'https://www.olx.pt/d/anuncio/car-0.html',
    title: 'Car 0',
  });
});

test('rejectPriceOutliers keeps everything below the 4-item threshold', () => {
  const items = [{ priceEur: 1000 }, { priceEur: 1000 }, { priceEur: 99999 }];
  assert.deepEqual(rejectPriceOutliers(items), items);
});

test('rejectPriceOutliers trims a price far outside the IQR fence', () => {
  const items = [9000, 9500, 10000, 10500, 11000, 69950].map((priceEur) => ({ priceEur }));
  const kept = rejectPriceOutliers(items);
  assert.equal(kept.length, 5);
  assert.ok(!kept.some((l) => l.priceEur === 69950));
});

test('rejectPriceOutliers leaves a tight cluster untouched', () => {
  const items = [20000, 21000, 22000, 23000, 24000].map((priceEur) => ({ priceEur }));
  assert.equal(rejectPriceOutliers(items).length, 5);
});

test('summarise excludes unpriced or URL-less listings from sampleListings', () => {
  const out = summarise(
    [
      { priceEur: 0, url: 'https://example.pt/zero' },
      { priceEur: 21000 }, // counts toward the average, but has no link
      { priceEur: 23000, url: 'https://example.pt/ok' },
    ],
    'olx.pt',
    {}
  );
  assert.equal(out.avgPriceEur, 22000);
  assert.equal(out.sampleSize, 2);
  assert.deepEqual(out.sampleListings, [{ priceEur: 23000, url: 'https://example.pt/ok' }]);
});
