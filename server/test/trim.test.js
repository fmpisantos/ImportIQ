import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrim, trimTierOf, strongerTier } from '../src/engine/trim.js';

const tier = (s) => classifyTrim(s).tier;

test('plain models with no trim marker are base', () => {
  for (const s of ['320d', 'BMW 318d', 'A4 Avant', 'Golf 1.6 TDI', 'Clio', '', null]) {
    assert.equal(tier(s), 'base', `${s} should be base`);
  }
});

test('sport appearance packages classify as sport (DE/EN names)', () => {
  for (const s of [
    '320d M Sport',
    '118i M Sportpaket',
    'A 200 d AMG Line',
    'A4 2.0 TDI S line',
    'Golf R-Line',
    'Tucson N Line',
    'Focus ST-Line',
    'Ceed GT Line',
    'A3 RS line',
  ]) {
    assert.equal(tier(s), 'sport', `${s} should be sport`);
  }
});

test('Portuguese sport-package renderings classify as sport', () => {
  assert.equal(tier('BMW 320d Pack M'), 'sport');
  assert.equal(tier('BMW 320d Linha M'), 'sport');
  assert.equal(tier('Mercedes A 180 Linha AMG'), 'sport');
});

test('genuine performance models classify as performance', () => {
  for (const s of [
    'M3',
    'BMW M4 Competition',
    'M340i xDrive',
    'M550d',
    'Audi RS6 Avant',
    'RS3',
    'Audi S4',
    'SQ5',
    'C 63 AMG',
    'A 45 AMG',
    'Golf GTI',
    'Golf GTD',
    'Golf R',
    'Leon Cupra',
    'Octavia vRS',
    'Juke Nismo',
  ]) {
    assert.equal(tier(s), 'performance', `${s} should be performance`);
  }
});

test('performance wins when a hot model also carries a sport package', () => {
  // "M340i M Sport" — the model is the categorical price driver, not the package.
  assert.equal(tier('M340i M Sport'), 'performance');
  assert.equal(tier('BMW M2 M Sportpaket'), 'performance');
});

test('sport-line names do NOT leak into performance (the RS/AMG/S collision)', () => {
  // bare "rs"/"amg"/"s" live inside these phrases but must stay 'sport'.
  assert.equal(tier('Audi A4 RS line'), 'sport');
  assert.equal(tier('Mercedes C 220 d AMG Line'), 'sport');
  assert.equal(tier('Audi A4 S line'), 'sport');
});

test('does not over-match common non-trim words', () => {
  assert.equal(tier('A3 Sportback 1.6 TDI'), 'base'); // "Sportback" body, not a trim
  assert.equal(tier('Mercedes ML 350'), 'base'); // "ML 350" is not M3..M8
  assert.equal(tier('C 350 e'), 'base');
});

test('trimTierOf is the tier shorthand', () => {
  assert.equal(trimTierOf('320d M Sport'), 'sport');
});

test('strongerTier keeps the pricier tier (card vs detail refinement)', () => {
  assert.equal(strongerTier('base', 'sport'), 'sport');
  assert.equal(strongerTier('sport', 'base'), 'sport');
  assert.equal(strongerTier('sport', 'performance'), 'performance');
  assert.equal(strongerTier('base', 'base'), 'base');
});
