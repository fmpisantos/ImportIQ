import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFuel, canonicalTransmission, leadingInt } from '../src/adapters/normalize.js';

// Regression guards for the "no PT average" bug: localized (accented) PT labels
// must canonicalise so they match the German listing's English labels.
test('canonicalTransmission handles accented/localized automatic labels', () => {
  for (const s of ['Automática', 'Automatik', 'Automatique', 'Automatico', 'DSG', 'PDK']) {
    assert.equal(canonicalTransmission(s), 'Automatic', s);
  }
  assert.equal(canonicalTransmission('Manual'), 'Manual');
});

test('canonicalFuel handles accented PT fuel labels', () => {
  assert.equal(canonicalFuel('Gasolina'), 'Petrol');
  assert.equal(canonicalFuel('Diesel'), 'Diesel');
  assert.equal(canonicalFuel('Elétrico'), 'Electric');
  assert.equal(canonicalFuel('Eléctrico'), 'Electric');
  assert.equal(canonicalFuel('Híbrido'), 'Hybrid');
  assert.equal(canonicalFuel('Híbrido Plug-In'), 'PHEV');
});

test('leadingInt parses the first number, ignoring a unit that ends in a digit', () => {
  assert.equal(leadingInt('1995 cm3'), 1995);
  assert.equal(leadingInt('1.995 cm³'), 1995);
  assert.equal(leadingInt('190 cv'), 190);
  assert.equal(leadingInt(null), null);
});
