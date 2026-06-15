import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalFuel,
  canonicalTransmission,
  leadingInt,
  inferEmissionStandard,
} from '../src/adapters/normalize.js';

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

// PT customs treats WLTP as the standard for cars first registered from
// 1 September 2018 (mandatory for all new EU registrations). 2018 is the
// transition year, so the month decides; everything is flagged inferred.
test('inferEmissionStandard follows the Sept-2018 WLTP cut-off', () => {
  assert.equal(inferEmissionStandard(2020).standard, 'WLTP');
  assert.equal(inferEmissionStandard(2019).standard, 'WLTP');
  assert.equal(inferEmissionStandard(2017).standard, 'NEDC');
  assert.equal(inferEmissionStandard(null).standard, 'NEDC');
  // 2018 transition: WLTP only from September.
  assert.equal(inferEmissionStandard(2018, 9).standard, 'WLTP');
  assert.equal(inferEmissionStandard(2018, 12).standard, 'WLTP');
  assert.equal(inferEmissionStandard(2018, 8).standard, 'NEDC');
  assert.equal(inferEmissionStandard(2018, null).standard, 'NEDC'); // unknown month → lean NEDC
  // Never claims to be authoritative — always inferred from scraped data.
  assert.equal(inferEmissionStandard(2020).inferred, true);
});

test('leadingInt parses the first number, ignoring a unit that ends in a digit', () => {
  assert.equal(leadingInt('1995 cm3'), 1995);
  assert.equal(leadingInt('1.995 cm³'), 1995);
  assert.equal(leadingInt('190 cv'), 190);
  assert.equal(leadingInt(null), null);
});
