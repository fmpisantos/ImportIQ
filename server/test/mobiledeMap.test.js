import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  mapAd,
  parseFirstRegistration,
  inferEmissionStandard,
  buildSearchParams,
} from '../src/adapters/mobiledeMap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'mobilede-search.json'), 'utf8')
);
const ads = fixture.ads.ad;

test('parseFirstRegistration handles yyyyMM and yyyy-MM', () => {
  assert.deepEqual(parseFirstRegistration('201906'), { year: 2019, month: 6 });
  assert.deepEqual(parseFirstRegistration('2017-03'), { year: 2017, month: 3 });
  assert.deepEqual(parseFirstRegistration(null), { year: null, month: null });
});

test('inferEmissionStandard: 2019+ → WLTP, earlier → NEDC', () => {
  assert.equal(inferEmissionStandard(2019).standard, 'WLTP');
  assert.equal(inferEmissionStandard(2020).standard, 'WLTP');
  assert.equal(inferEmissionStandard(2017).standard, 'NEDC');
  assert.equal(inferEmissionStandard(null).standard, 'NEDC');
});

test('mapAd maps a petrol BMW into the normalised listing shape', () => {
  const l = mapAd(ads[0], 2025);
  assert.equal(l.id, '412345678');
  assert.equal(l.brand, 'BMW');
  assert.equal(l.priceEur, 18900);
  assert.equal(l.mileageKm, 64000);
  assert.equal(l.displacementCm3, 1998);
  assert.equal(l.co2GKm, 132);
  assert.equal(l.fuelType, 'Petrol');
  assert.equal(l.transmission, 'Automatic');
  assert.equal(l.firstRegYear, 2019);
  assert.equal(l.emissionStandard, 'WLTP');
  assert.equal(l.emissionStandardInferred, true);
  assert.equal(l.ageYears, 6); // 2025 - 2019
  assert.equal(l.url, 'https://www.mobile.de/fahrzeuge/details.html?id=412345678');
  assert.equal(l.thumbnailUrl, 'https://img.mobile.de/412345678/1.jpg');
});

test('mapAd maps a diesel Audi with NEDC inference (2017)', () => {
  const l = mapAd(ads[1], 2025);
  assert.equal(l.fuelType, 'Diesel');
  assert.equal(l.transmission, 'Manual');
  assert.equal(l.emissionStandard, 'NEDC');
  assert.equal(l.ageYears, 8);
});

test('mapped listings flow through the ISV/landed-cost engine', async () => {
  // The whole point of the mapping: its output must be directly consumable by
  // the engine without adaptation.
  const { computeLandedCost } = await import('../src/engine/landedCost.js');
  const listing = mapAd(ads[0], 2025);
  const config = {
    byKey: {
      'transport.open_carrier': {
        key: 'transport.open_carrier',
        label: 'Open carrier',
        category: 'transport',
        amount_eur: 600,
        enabled: true,
      },
      'fee.dua': { key: 'fee.dua', label: 'DUA', category: 'legalisation', amount_eur: 65, enabled: true },
    },
    activeTransportMethod: 'transport.open_carrier',
  };
  const result = computeLandedCost(listing, config);
  assert.equal(result.incomplete, false);
  assert.ok(result.breakdown.isv.isv > 0);
  assert.equal(
    result.totalLandedCostEur,
    Math.round((18900 + result.breakdown.isv.isv + 600 + 65) * 100) / 100
  );
});

test('buildSearchParams encodes filters into mobile.de param names', () => {
  const p = buildSearchParams(
    { priceMin: 5000, priceMax: 20000, yearFrom: 2018, maxMileageKm: 100000, fuelTypes: ['Petrol', 'Diesel'], transmission: 'Automatic' },
    'refdata/classes/Car/makes/BMW/models/3ER'
  );
  assert.equal(p.get('country'), 'DE');
  assert.equal(p.get('condition'), 'USED');
  assert.equal(p.get('classification'), 'refdata/classes/Car/makes/BMW/models/3ER');
  assert.equal(p.get('price.min'), '5000');
  assert.equal(p.get('price.max'), '20000');
  assert.equal(p.get('firstRegistrationDate.min'), '2018-01');
  assert.equal(p.get('mileage.max'), '100000');
  assert.equal(p.get('gearbox'), 'AUTOMATIC_GEAR');
  assert.deepEqual(p.getAll('fuel'), ['PETROL', 'DIESEL']);
});
