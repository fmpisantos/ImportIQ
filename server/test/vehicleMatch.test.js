import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize,
  diceCoefficient,
  tokenSim,
  buildVehicleIndex,
  matchVehicle,
} from '../src/engine/vehicleMatch.js';

// A small self-contained catalog so the tests don't depend on the full data file.
const CATALOG = [
  { brand: 'BMW', aliases: ['bimmer'], models: { '3 Series': ['320d', 'Touring', 'M340i'], X5: ['xDrive30d'] } },
  {
    brand: 'Mercedes-Benz',
    aliases: ['mercedes', 'merc', 'mercedez'],
    models: { 'C-Class': ['C 220 d', 'AMG C 63'], 'A-Class': ['A 200'] },
  },
  { brand: 'Volkswagen', aliases: ['vw'], models: { Golf: ['GTI', '2.0 TDI'], Polo: ['1.0 TSI'] } },
  { brand: 'Audi', models: { A4: ['40 TDI', 'Avant'], Q5: ['45 TFSI'] } },
];

const index = buildVehicleIndex(CATALOG);
const top = (q) => matchVehicle(q, index, { limit: 5 })[0];

test('tokenize lowercases, folds accents, splits on non-alphanumerics', () => {
  assert.deepEqual(tokenize('Mercedes-Benz C220d!'), ['mercedes', 'benz', 'c220d']);
  assert.deepEqual(tokenize('Škoda Octavia'), ['skoda', 'octavia']);
});

test('diceCoefficient is 1 for equal strings and high for near-typos', () => {
  assert.equal(diceCoefficient('golf', 'golf'), 1);
  assert.ok(diceCoefficient('mercedez', 'mercedes') > 0.7);
  assert.ok(diceCoefficient('golf', 'tesla') < 0.2);
});

test('tokenSim rewards prefix/containment (320d ≈ 320)', () => {
  assert.equal(tokenSim('amg', 'amg'), 1);
  assert.ok(tokenSim('320', '320d') > 0.8);
  assert.ok(tokenSim('amg', 'amgline') > 0.7);
});

test('exact brand+model resolves to that entry', () => {
  const m = top('BMW 3 Series');
  assert.equal(m.brand, 'BMW');
  assert.equal(m.model, '3 Series');
  assert.ok(m.score > 0.9);
});

test('brand alias short-circuits to the brand (vw golf)', () => {
  const m = top('vw golf gti');
  assert.equal(m.brand, 'Volkswagen');
  assert.equal(m.model, 'Golf');
  assert.equal(m.submodel, 'GTI');
});

test('typo in brand still matches (mercedez benz c220)', () => {
  const m = top('mercedez benz c220 amg');
  assert.equal(m.brand, 'Mercedes-Benz');
  assert.equal(m.model, 'C-Class');
});

test('noise words (year, fuel, mileage) are ignored', () => {
  const m = top('bmw 320d touring 2019 diesel 120000km');
  assert.equal(m.brand, 'BMW');
  assert.equal(m.model, '3 Series');
  assert.ok(['320d', 'Touring'].includes(m.submodel));
});

test('returns the best match even when nothing matches exactly (never empty)', () => {
  const matches = matchVehicle('audo a4 avant', index, { limit: 3 });
  assert.ok(matches.length > 0);
  assert.equal(matches[0].brand, 'Audi');
  assert.equal(matches[0].model, 'A4');
});

test('empty / whitespace query yields no matches', () => {
  assert.deepEqual(matchVehicle('   ', index), []);
});

test('results are ranked descending by score with a confidence label', () => {
  const matches = matchVehicle('golf', index, { limit: 5 });
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1].score >= matches[i].score);
  }
  assert.ok(['high', 'medium', 'low'].includes(matches[0].confidence));
});
