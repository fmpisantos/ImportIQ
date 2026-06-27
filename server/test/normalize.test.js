import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalFuel,
  canonicalTransmission,
  leadingInt,
  inferEmissionStandard,
  parseRegMonth,
  qualifiesForReducedEvRegime,
} from '../src/adapters/normalize.js';

test('parseRegMonth pulls the month from AS24 / ISO date shapes', () => {
  assert.equal(parseRegMonth('09-2008'), 9); // AS24 card
  assert.equal(parseRegMonth('09/2008'), 9); // AS24 detail
  assert.equal(parseRegMonth('3/2019'), 3);
  assert.equal(parseRegMonth('2008-09-01'), 9); // ISO
  assert.equal(parseRegMonth('2019-03'), 3);
  assert.equal(parseRegMonth(new Date(Date.UTC(2020, 5, 1))), 6);
});

test('parseRegMonth returns null for a bare year or junk (never guesses a month)', () => {
  assert.equal(parseRegMonth('2026'), null);
  assert.equal(parseRegMonth(2026), null);
  assert.equal(parseRegMonth('13-2020'), null); // invalid month
  assert.equal(parseRegMonth(''), null);
  assert.equal(parseRegMonth(null), null);
});

test('qualifiesForReducedEvRegime: PHEV with ≥50 km range AND <50 g/km only', () => {
  assert.equal(qualifiesForReducedEvRegime('phev', 60, 30), true);
  assert.equal(qualifiesForReducedEvRegime('phev', 40, 30), false); // range too short
  assert.equal(qualifiesForReducedEvRegime('phev', 60, 55), false); // CO₂ too high
  assert.equal(qualifiesForReducedEvRegime('phev', null, 30), false); // unknown range → no discount
  assert.equal(qualifiesForReducedEvRegime('hybrid', 60, 30), false); // not a plug-in
  assert.equal(qualifiesForReducedEvRegime('diesel', 60, 30), false);
});

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

test('canonicalFuel reads a combined electric+combustion label as PHEV, not Electric', () => {
  // AS24 tags plug-in hybrids "Elektro/Diesel" / "Elektro/Benzin". They must NOT
  // resolve to Electric (which would wrongly grant the €0 ISV exemption).
  assert.equal(canonicalFuel('Elektro/Diesel'), 'PHEV');
  assert.equal(canonicalFuel('Elektro/Benzin'), 'PHEV');
  assert.equal(canonicalFuel('Benzin/Elektro'), 'PHEV');
  // A pure-electric label still resolves to Electric.
  assert.equal(canonicalFuel('Elektro'), 'Electric');
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
