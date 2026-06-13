import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarise,
  comparisonCriteria,
  rejectPriceOutliers,
  comparableMatches,
  withinComparisonWindow,
  median,
  regressionEstimate,
  estimateMarketValue,
  finalizeComparison,
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

// --- comparableMatches (shared matcher: model/fuel/transmission/power/displ) ---

const SUBJECT = {
  model: '320',
  fuelType: 'Diesel',
  transmission: 'Automatic',
  powerKw: 140,
  displacementCm3: 1995,
};

test('comparableMatches accepts a same-spec comparable within engine tolerances', () => {
  const c = { model: '320', fuel: 'Diesel', transmission: 'Automatic', powerKw: 140, displacementCm3: 2000 };
  assert.equal(comparableMatches(c, SUBJECT), true);
});

test('comparableMatches rejects a far-off power (e.g. a much more powerful variant)', () => {
  const c = { model: '320', fuel: 'Diesel', powerKw: 220 }; // 220 vs 140 ⇒ >20%
  assert.equal(comparableMatches(c, SUBJECT), false);
});

test('comparableMatches rejects a far-off displacement', () => {
  const c = { model: '320', fuel: 'Diesel', displacementCm3: 2998 }; // vs 1995 ⇒ >15%
  assert.equal(comparableMatches(c, SUBJECT), false);
});

test('comparableMatches is field-tolerant — missing power/displacement is not a drop', () => {
  const c = { model: '320', fuel: 'Diesel', transmission: 'Automatic' }; // no engine fields
  assert.equal(comparableMatches(c, SUBJECT), true);
});

test('comparableMatches rejects a different model family', () => {
  const c = { model: 'M3', fuel: 'Diesel', powerKw: 140 };
  assert.equal(comparableMatches(c, SUBJECT), false);
});

// --- withinComparisonWindow -------------------------------------------------

const WINDOW = { yearRange: [2018, 2020], mileageRangeKm: [44000, 84000] };

test('withinComparisonWindow keeps an in-window comparable and drops out-of-window ones', () => {
  assert.equal(withinComparisonWindow({ year: 2019, mileageKm: 60000 }, WINDOW), true);
  assert.equal(withinComparisonWindow({ year: 2017, mileageKm: 60000 }, WINDOW), false);
  assert.equal(withinComparisonWindow({ year: 2019, mileageKm: 90000 }, WINDOW), false);
  assert.equal(withinComparisonWindow({ year: null, mileageKm: null }, WINDOW), true); // tolerant
});

// --- median / regression / market-value estimate ----------------------------

test('median handles odd and even sets', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([]), null);
});

// Perfectly linear y = 25000 − 0.1·km over 50k–150k.
const LINEAR_POINTS = [50000, 70000, 90000, 110000, 130000, 150000].map((x) => ({
  x,
  y: 25000 - 0.1 * x,
}));

test('regressionEstimate predicts at the target mileage for a clean negative trend', () => {
  assert.equal(regressionEstimate(LINEAR_POINTS, 75000), 17500);
});

test('regressionEstimate clamps the prediction to the observed price range', () => {
  // target km=0 would extrapolate to 25000 but observed max is 20000 → clamped.
  assert.equal(regressionEstimate(LINEAR_POINTS, 0), 20000);
});

test('regressionEstimate returns null below the minimum point count', () => {
  assert.equal(regressionEstimate(LINEAR_POINTS.slice(0, 4), 75000), null);
});

test('regressionEstimate returns null when price rises with mileage (no real signal)', () => {
  const rising = LINEAR_POINTS.map((p) => ({ x: p.x, y: 10000 + 0.1 * p.x }));
  assert.equal(regressionEstimate(rising, 75000), null);
});

test('estimateMarketValue uses the mileage regression when mileages are present', () => {
  const items = LINEAR_POINTS.map((p) => ({ priceEur: p.y, mileageKm: p.x }));
  const out = estimateMarketValue(items, { mileageKm: 75000 });
  assert.equal(out.marketValueMethod, 'mileage-regression');
  assert.equal(out.marketValueEur, 17500);
  assert.equal(out.medianPriceEur, 15000);
});

test('estimateMarketValue falls back to the median without usable mileages', () => {
  const items = [12000, 14000, 16000].map((priceEur) => ({ priceEur }));
  const out = estimateMarketValue(items, {});
  assert.equal(out.marketValueMethod, 'median');
  assert.equal(out.marketValueEur, 14000);
});

test('finalizeComparison carries mean, robust estimate and low-confidence flag', () => {
  const items = LINEAR_POINTS.map((p) => ({ priceEur: p.y, mileageKm: p.x }));
  const out = finalizeComparison({
    items,
    source: 'olx.pt + standvirtual',
    criteria: WINDOW,
    listing: { mileageKm: 75000, model: '320', fuelType: 'Diesel' },
  });
  assert.equal(out.sampleSize, 6);
  assert.equal(out.avgPriceEur, 15000); // mean of the symmetric set
  assert.equal(out.marketValueEur, 17500); // regression at 75k
  assert.equal(out.lowConfidence, false);
  assert.equal(out.matchedCriteria.fuelType, 'Diesel');
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
