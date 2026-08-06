// Display-ranking rules (engine/ranking.js): a car with no PT benchmark never
// outranks one we could actually judge, whatever the sort key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPtBenchmark,
  rankComputedResults,
  sinkWithoutPtBenchmark,
} from '../src/engine/ranking.js';

// A computed result, reduced to the fields ranking reads.
const r = (id, savingEur, extra = {}) => ({ listing: { id }, savingEur, ...extra });

test('hasPtBenchmark is true only when a saving was actually staked', () => {
  assert.equal(hasPtBenchmark(r('a', 1200)), true);
  assert.equal(hasPtBenchmark(r('b', 0)), true, 'a zero saving is still a verdict');
  assert.equal(hasPtBenchmark(r('c', -500)), true, 'so is a negative one');
  assert.equal(hasPtBenchmark(r('d', null)), false); // no/unreliable PT sample, or incomplete
  assert.equal(hasPtBenchmark(undefined), false);
});

test('rankComputedResults sinks un-benchmarked results below every benchmarked one', () => {
  // The un-benchmarked car has the best raw key on both directions.
  const items = [
    r('noPt', null, { totalLandedCostEur: 5000 }),
    r('lo', 100, { totalLandedCostEur: 25000 }),
    r('hi', 900, { totalLandedCostEur: 35000 }),
  ];

  assert.deepEqual(
    rankComputedResults(items, (x) => x.savingEur, true).map((x) => x.listing.id),
    ['hi', 'lo', 'noPt']
  );
  assert.deepEqual(
    rankComputedResults(items, (x) => x.totalLandedCostEur, false).map((x) => x.listing.id),
    ['lo', 'hi', 'noPt']
  );
});

test('rankComputedResults keeps null keys last within the un-benchmarked tier', () => {
  const items = [
    r('incomplete', null, { totalLandedCostEur: null }),
    r('noPt', null, { totalLandedCostEur: 9000 }),
    r('ok', 500, { totalLandedCostEur: 25000 }),
  ];
  assert.deepEqual(
    rankComputedResults(items, (x) => x.totalLandedCostEur, false).map((x) => x.listing.id),
    ['ok', 'noPt', 'incomplete']
  );
});

test('rankComputedResults is stable on ties and leaves the input untouched', () => {
  const items = [r('a', 100), r('b', 100), r('c', 100)];
  assert.deepEqual(
    rankComputedResults(items, (x) => x.savingEur, true).map((x) => x.listing.id),
    ['a', 'b', 'c']
  );
  assert.deepEqual(items.map((x) => x.listing.id), ['a', 'b', 'c'], 'input array not mutated');
});

test('rankComputedResults treats NaN keys as missing', () => {
  const items = [r('nan', 500, { key: NaN }), r('num', 500, { key: 10 })];
  assert.deepEqual(
    rankComputedResults(items, (x) => x.key, false).map((x) => x.listing.id),
    ['num', 'nan']
  );
});

test('sinkWithoutPtBenchmark preserves the source order within each tier', () => {
  const items = [r('p1', null), r('p2', 300), r('p3', null), r('p4', 100)];
  assert.deepEqual(
    sinkWithoutPtBenchmark(items).map((x) => x.listing.id),
    ['p2', 'p4', 'p1', 'p3'],
    'benchmarked cars keep AS24 order, un-benchmarked ones follow in their own order'
  );
});
