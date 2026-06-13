import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateGermanPriceSanity } from '../src/engine/priceSanity.js';

const r = (brand, model, priceEur) => ({ listing: { brand, model, priceEur } });

test('flags a same-model price far below the run median', () => {
  const results = [
    r('BMW', '320d', 18000),
    r('BMW', '320d', 19000),
    r('BMW', '320d', 20000),
    r('BMW', '320d', 21000),
    r('BMW', '320d', 4000), // ~21% of the €19,000 median → suspicious
  ];
  const out = annotateGermanPriceSanity(results);
  assert.equal(out[4].germanPriceSuspicious, true);
  assert.ok(out[4].germanPriceNotes[0].includes('median'));
  assert.equal(out[0].germanPriceSuspicious, undefined); // normal ones untouched
});

test('flags any price below the absolute floor regardless of group size', () => {
  const out = annotateGermanPriceSanity([r('Lada', 'Niva', 800)]);
  assert.equal(out[0].germanPriceSuspicious, true);
  assert.ok(out[0].germanPriceNotes[0].includes('below'));
});

test('does not flag a small group without an absurd price', () => {
  const out = annotateGermanPriceSanity([r('Audi', 'A4', 9000), r('Audi', 'A4', 4500)]);
  // Only 2 peers (< MIN_GROUP) ⇒ no relative flag; both above the floor.
  assert.ok(out.every((x) => !x.germanPriceSuspicious));
});
