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
  selectByTrim,
  priceDispersion,
  engineMatchStats,
  gradeConfidence,
  selectByEngineTier,
  multiRegressionEstimate,
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

test('comparableMatches keeps a more-specific trim of the subject family', () => {
  // comparable "320 d AMG" CONTAINS the subject family "320" — legit comparable.
  const c = { model: '320 d', fuel: 'Diesel', transmission: 'Automatic', powerKw: 140 };
  assert.equal(comparableMatches(c, SUBJECT), true);
});

test('comparableMatches falls back to the title when the structured model is absent', () => {
  // OLX leaves `modelo` null on whole model lines (911s, Cayennes), so a brand
  // search drags them into a Panamera benchmark unless the title gates them out.
  const subject = { model: 'Panamera', fuelType: 'Petrol' };
  // Same brand, missing structured model, WRONG line in the title → dropped.
  assert.equal(
    comparableMatches({ model: null, title: 'Porsche 911 (992) Turbo S PDK', fuel: 'Petrol' }, subject),
    false
  );
  // Same brand, missing structured model, RIGHT line in the title → kept.
  assert.equal(
    comparableMatches({ model: null, title: 'Porsche Panamera 4S E-Hybrid', fuel: 'Petrol' }, subject),
    true
  );
  // Neither structured model nor title → can't prove a mismatch, stays kept.
  assert.equal(comparableMatches({ model: null, fuel: 'Petrol' }, subject), true);
});

test('comparableMatches does NOT match up to a broader, costlier model line', () => {
  // The Velar regression: a flagship "Range Rover" must not match a
  // "Range Rover Velar" subject just because the subject contains "range rover".
  const subject = { model: 'Range Rover Velar', fuelType: 'Diesel' };
  assert.equal(comparableMatches({ model: 'Range Rover', fuel: 'Diesel' }, subject), false);
  // …while a genuine Velar trim still matches.
  assert.equal(
    comparableMatches({ model: 'Range Rover Velar 3.0 D HSE', fuel: 'Diesel' }, subject),
    true
  );
});

// --- trim-tier matching -----------------------------------------------------

test('comparableMatches drops a performance car when the subject is not (and vice versa)', () => {
  const baseSubject = { ...SUBJECT, trimTier: 'base' };
  const perfComp = { model: '320', fuel: 'Diesel', powerKw: 140, trimTier: 'performance' };
  assert.equal(comparableMatches(perfComp, baseSubject), false);

  const perfSubject = { ...SUBJECT, trimTier: 'performance' };
  const baseComp = { model: '320', fuel: 'Diesel', powerKw: 140, trimTier: 'base' };
  assert.equal(comparableMatches(baseComp, perfSubject), false);
});

test('comparableMatches keeps a sport-package comparable for a base subject (only performance is categorical)', () => {
  const baseSubject = { ...SUBJECT, trimTier: 'base' };
  const sportComp = { model: '320', fuel: 'Diesel', powerKw: 140, trimTier: 'sport' };
  assert.equal(comparableMatches(sportComp, baseSubject), true);
});

test('comparableMatches stays trim-agnostic when tiers are unknown (back-compat)', () => {
  const c = { model: '320', fuel: 'Diesel', powerKw: 140 }; // no trimTier
  assert.equal(comparableMatches(c, SUBJECT), true); // SUBJECT has no trimTier either
});

test('selectByTrim narrows to same-tier comparables when enough survive', () => {
  const items = [
    { priceEur: 20000, trimTier: 'base' },
    { priceEur: 21000, trimTier: 'base' },
    { priceEur: 22000, trimTier: 'base' },
    { priceEur: 34000, trimTier: 'sport' }, // pricier sport trims to exclude
    { priceEur: 35000, trimTier: 'sport' },
  ];
  const out = selectByTrim(items, { trimTier: 'base' });
  assert.equal(out.trimMatched, true);
  assert.equal(out.items.length, 3);
  assert.ok(out.items.every((i) => i.trimTier === 'base'));
  assert.deepEqual(out.trimBreakdown, { base: 3, sport: 2, performance: 0 });
});

test('selectByTrim falls back to the full set when same-tier is too thin, flagging trimMatched=false', () => {
  const items = [
    { priceEur: 20000, trimTier: 'base' },
    { priceEur: 34000, trimTier: 'sport' },
    { priceEur: 35000, trimTier: 'sport' },
    { priceEur: 36000, trimTier: 'sport' },
  ];
  const out = selectByTrim(items, { trimTier: 'base' }); // only 1 base < MIN_RELIABLE_SAMPLE
  assert.equal(out.trimMatched, false);
  assert.equal(out.items.length, 4);
});

test('selectByTrim is a no-op when the subject tier is unknown', () => {
  const items = [{ priceEur: 20000, trimTier: 'base' }];
  const out = selectByTrim(items, {});
  assert.equal(out.trimMatched, null);
  assert.equal(out.items.length, 1);
});

test('finalizeComparison narrows to same-tier and surfaces trim fields', () => {
  const items = [
    { priceEur: 20000, trimTier: 'base' },
    { priceEur: 21000, trimTier: 'base' },
    { priceEur: 22000, trimTier: 'base' },
    { priceEur: 40000, trimTier: 'sport' },
    { priceEur: 41000, trimTier: 'sport' },
  ];
  const out = finalizeComparison({
    items,
    source: 'olx.pt',
    criteria: WINDOW,
    listing: { model: '320', fuelType: 'Diesel', trimTier: 'base', mileageKm: 60000 },
  });
  assert.equal(out.trimTier, 'base');
  assert.equal(out.trimMatched, true);
  assert.equal(out.sampleSize, 3); // sport trims excluded from the benchmark
  assert.ok(out.marketValueEur <= 22000, 'market value reflects base trims only');
  assert.deepEqual(out.trimBreakdown, { base: 3, sport: 2, performance: 0 });
  assert.equal(out.matchedCriteria.trimTier, 'base');
});

// --- confidence: dispersion + engine-match + grading -----------------------

test('priceDispersion reports relative IQR and the raw range, null when too few', () => {
  assert.equal(priceDispersion([{ priceEur: 20000 }, { priceEur: 21000 }]), null);
  const d = priceDispersion([
    { priceEur: 18000 }, { priceEur: 20000 }, { priceEur: 22000 }, { priceEur: 24000 },
  ]);
  assert.equal(d.minPriceEur, 18000);
  assert.equal(d.maxPriceEur, 24000);
  assert.ok(d.relIqr > 0 && d.relIqr < 1);
});

test('engineMatchStats counts only comparables with both engine fields against a spec-bearing subject', () => {
  const subject = { powerKw: 140, displacementCm3: 1995 };
  const items = [
    { priceEur: 20000, powerKw: 140, displacementCm3: 2000 }, // engine-matched
    { priceEur: 21000, powerKw: 135 }, // missing displacement → model-only
    { priceEur: 22000 }, // no engine fields → model-only
  ];
  const s = engineMatchStats(items, subject);
  assert.equal(s.subjectHasSpec, true);
  assert.equal(s.matched, 1);
  assert.equal(s.total, 3);
  assert.equal(s.ratio, 0.33);
});

test('engineMatchStats reports subjectHasSpec=false and zero matches when the subject lacks engine data', () => {
  const s = engineMatchStats([{ powerKw: 140, displacementCm3: 2000 }], { model: '320' });
  assert.equal(s.subjectHasSpec, false);
  assert.equal(s.matched, 0);
});

test('gradeConfidence is high for a clean benchmark and low when signals stack', () => {
  const high = gradeConfidence({
    sampleSize: 8,
    engine: { ratio: 0.9, subjectHasSpec: true },
    dispersion: { relIqr: 0.12 },
    trimMatched: true,
  });
  assert.equal(high.level, 'high');
  assert.deepEqual(high.factors, []);

  const low = gradeConfidence({
    sampleSize: 4, // small-sample
    engine: { ratio: 0.2, subjectHasSpec: true }, // mostly-model-only
    dispersion: { relIqr: 0.7 }, // very-high-spread (+2)
    trimMatched: false, // trim-not-matched
  });
  assert.equal(low.level, 'low');
  assert.ok(low.factors.includes('very-high-price-spread'));
});

test('finalizeComparison surfaces confidence, dispersion and engineMatch', () => {
  const items = [
    { priceEur: 19000, powerKw: 140, displacementCm3: 1995, trimTier: 'base' },
    { priceEur: 20000, powerKw: 138, displacementCm3: 1998, trimTier: 'base' },
    { priceEur: 21000, powerKw: 140, displacementCm3: 2000, trimTier: 'base' },
    { priceEur: 20500, powerKw: 142, displacementCm3: 1995, trimTier: 'base' },
    { priceEur: 19500, powerKw: 139, displacementCm3: 1990, trimTier: 'base' },
  ];
  const out = finalizeComparison({
    items,
    source: 'olx.pt',
    criteria: WINDOW,
    listing: { model: '320', fuelType: 'Diesel', trimTier: 'base', powerKw: 140, displacementCm3: 1995, mileageKm: 60000 },
  });
  assert.equal(out.confidence, 'high');
  assert.equal(out.engineMatch.matched, 5);
  assert.equal(out.engineMatch.subjectHasSpec, true);
  assert.ok(out.dispersion.relIqr != null);
  assert.deepEqual(out.confidenceFactors, []);
});

// --- C: tiered engine tolerances -------------------------------------------

test('selectByEngineTier narrows to the tight band when enough mechanically-identical comparables exist', () => {
  const subject = { powerKw: 140, displacementCm3: 1995 };
  const items = [
    { priceEur: 20000, powerKw: 140, displacementCm3: 1995 }, // exact
    { priceEur: 21000, powerKw: 145, displacementCm3: 2000 }, // within ±12%/±8%
    { priceEur: 22000, powerKw: 135, displacementCm3: 1990 }, // within
    { priceEur: 30000, powerKw: 190, displacementCm3: 2998 }, // 330d-ish — outside tight
  ];
  const out = selectByEngineTier(items, subject);
  assert.equal(out.engineTier, 'tight');
  assert.equal(out.items.length, 3);
});

test('selectByEngineTier falls back to loose when too few sit in the tight band', () => {
  const subject = { powerKw: 140, displacementCm3: 1995 };
  const items = [
    { priceEur: 20000, powerKw: 140, displacementCm3: 1995 }, // only 1 tight
    { priceEur: 30000, powerKw: 190, displacementCm3: 2998 },
    { priceEur: 31000, powerKw: 185, displacementCm3: 2998 },
    { priceEur: 32000, powerKw: 188, displacementCm3: 2998 },
  ];
  const out = selectByEngineTier(items, subject);
  assert.equal(out.engineTier, 'loose');
  assert.equal(out.items.length, 4);
});

test('selectByEngineTier is a no-op (engineTier null) when the subject lacks engine specs', () => {
  const items = [{ priceEur: 20000, powerKw: 140, displacementCm3: 1995 }];
  const out = selectByEngineTier(items, { model: '320' });
  assert.equal(out.engineTier, null);
  assert.equal(out.items.length, 1);
});

test('selectByEngineTier does not count spec-less comparables as tight matches', () => {
  const subject = { powerKw: 140, displacementCm3: 1995 };
  const items = [
    { priceEur: 20000, powerKw: 140, displacementCm3: 1995 },
    { priceEur: 21000 }, // no specs — must NOT count toward the tight set
    { priceEur: 22000 },
  ];
  const out = selectByEngineTier(items, subject);
  assert.equal(out.engineTier, 'loose'); // only 1 genuine tight match < MIN
});

// --- D: spec-normalized (mileage + power) regression -----------------------

test('multiRegressionEstimate predicts at the subject mileage+power when power genuinely varies', () => {
  // Price rises with power, falls with mileage. Subject: high power, low mileage.
  const points = [
    { x1: 100000, x2: 110, y: 18000 },
    { x1: 90000, x2: 120, y: 21000 },
    { x1: 80000, x2: 130, y: 24000 },
    { x1: 70000, x2: 140, y: 27000 },
    { x1: 120000, x2: 110, y: 16000 },
    { x1: 110000, x2: 120, y: 19000 },
    { x1: 95000, x2: 130, y: 23000 },
    { x1: 60000, x2: 140, y: 28000 },
  ];
  const est = multiRegressionEstimate(points, { x1: 70000, x2: 140 });
  assert.ok(est != null);
  assert.ok(est > 24000, `expected a high-power/low-mileage estimate, got ${est}`);
});

test('multiRegressionEstimate returns null when power has no variation (degenerate 2nd predictor)', () => {
  const points = Array.from({ length: 8 }, (_, i) => ({ x1: 100000 - i * 5000, x2: 140, y: 20000 + i * 500 }));
  assert.equal(multiRegressionEstimate(points, { x1: 80000, x2: 140 }), null);
});

test('multiRegressionEstimate returns null below the minimum point count', () => {
  const points = [
    { x1: 100000, x2: 110, y: 18000 },
    { x1: 90000, x2: 120, y: 21000 },
    { x1: 80000, x2: 130, y: 24000 },
  ];
  assert.equal(multiRegressionEstimate(points, { x1: 80000, x2: 130 }), null);
});

test('estimateMarketValue prefers the spec-normalized method when it fits', () => {
  const items = [
    { priceEur: 18000, mileageKm: 100000, powerKw: 110 },
    { priceEur: 21000, mileageKm: 90000, powerKw: 120 },
    { priceEur: 24000, mileageKm: 80000, powerKw: 130 },
    { priceEur: 27000, mileageKm: 70000, powerKw: 140 },
    { priceEur: 16000, mileageKm: 120000, powerKw: 110 },
    { priceEur: 19000, mileageKm: 110000, powerKw: 120 },
    { priceEur: 23000, mileageKm: 95000, powerKw: 130 },
    { priceEur: 28000, mileageKm: 60000, powerKw: 140 },
  ];
  const out = estimateMarketValue(items, { mileageKm: 70000, powerKw: 140 });
  assert.equal(out.marketValueMethod, 'mileage-power-regression');
});

test('finalizeComparison records the engine tier used', () => {
  const items = [
    { priceEur: 19000, powerKw: 140, displacementCm3: 1995, mileageKm: 90000, trimTier: 'base' },
    { priceEur: 20000, powerKw: 138, displacementCm3: 1998, mileageKm: 85000, trimTier: 'base' },
    { priceEur: 21000, powerKw: 142, displacementCm3: 2000, mileageKm: 80000, trimTier: 'base' },
    { priceEur: 30000, powerKw: 190, displacementCm3: 2998, mileageKm: 70000, trimTier: 'base' }, // 330d, outside tight
  ];
  const out = finalizeComparison({
    items,
    source: 'olx.pt',
    criteria: WINDOW,
    listing: { model: '320', fuelType: 'Diesel', trimTier: 'base', powerKw: 140, displacementCm3: 1995, mileageKm: 85000 },
  });
  assert.equal(out.engineTier, 'tight');
  assert.equal(out.matchedCriteria.engineTier, 'tight');
  assert.equal(out.sampleSize, 3); // the 330d dropped from the benchmark
});

test('finalizeComparison withholds reliability below the minimum sample', () => {
  const items = [{ priceEur: 50000 }, { priceEur: 52000 }]; // only 2 comparables
  const out = finalizeComparison({
    items,
    source: 'olx.pt',
    criteria: WINDOW,
    listing: { model: 'X4', fuelType: 'Diesel' },
  });
  assert.equal(out.reliable, false);
  assert.equal(out.unreliableReason, 'insufficient-sample');
});

test('finalizeComparison is reliable at or above the minimum sample', () => {
  const items = [{ priceEur: 50000 }, { priceEur: 52000 }, { priceEur: 51000 }];
  const out = finalizeComparison({
    items,
    source: 'olx.pt',
    criteria: WINDOW,
    listing: { model: 'X4', fuelType: 'Diesel' },
  });
  assert.equal(out.reliable, true);
  assert.equal(out.unreliableReason, null);
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
