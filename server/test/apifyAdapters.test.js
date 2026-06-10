import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  intFrom,
  canonicalFuel,
  canonicalTransmission,
  parseYear,
  inferEmissionStandard,
  slugify,
  matchesFilters,
} from '../src/adapters/normalize.js';

import * as mobilede from '../src/adapters/sites/mobilede.js';
import * as autoscout24 from '../src/adapters/sites/autoscout24.js';
import * as autouncle from '../src/adapters/sites/autouncle.js';

// --- normalize helpers ------------------------------------------------------

test('intFrom strips currency, units and thousands separators', () => {
  assert.equal(intFrom('12.000 €'), 12000);
  assert.equal(intFrom('120 000 km'), 120000);
  assert.equal(intFrom("1'968 cm³"), 1968);
  assert.equal(intFrom(18500), 18500);
  assert.equal(intFrom(''), null);
  assert.equal(intFrom(null), null);
});

test('canonicalFuel maps localized labels onto the canonical set', () => {
  assert.equal(canonicalFuel('Benzin'), 'Petrol');
  assert.equal(canonicalFuel('Elektro'), 'Electric');
  assert.equal(canonicalFuel('Plug-in-Hybrid'), 'PHEV');
  assert.equal(canonicalFuel('Diesel'), 'Diesel');
  assert.equal(canonicalFuel('Autogas (LPG)'), 'LPG');
  assert.equal(canonicalFuel(''), null);
});

test('canonicalTransmission collapses gearbox labels', () => {
  assert.equal(canonicalTransmission('Schaltgetriebe'), 'Manual');
  assert.equal(canonicalTransmission('Automatik (DSG)'), 'Automatic');
  assert.equal(canonicalTransmission('S tronic'), 'Automatic');
});

test('parseYear handles 2019, "03/2019", "2019-03" and Dates', () => {
  assert.equal(parseYear(2019), 2019);
  assert.equal(parseYear('03/2019'), 2019);
  assert.equal(parseYear('2019-03'), 2019);
  assert.equal(parseYear(null), null);
});

test('emission standard inferred from registration year', () => {
  assert.deepEqual(inferEmissionStandard(2020), { standard: 'WLTP', inferred: true });
  assert.deepEqual(inferEmissionStandard(2015), { standard: 'NEDC', inferred: true });
});

test('slugify lowercases and dashes for actor make/model slugs', () => {
  assert.equal(slugify('Mercedes-Benz'), 'mercedes-benz');
  assert.equal(slugify('A4 Avant'), 'a4-avant');
  assert.equal(slugify('Citroën'), 'citroen');
});

// --- post-filter ------------------------------------------------------------

test('matchesFilters enforces filters but keeps listings missing a field', () => {
  const listing = { brand: 'BMW', model: '320i', year: 2019, priceEur: 18500, mileageKm: 68000, fuelType: 'Petrol', transmission: 'Automatic' };
  assert.equal(matchesFilters(listing, { brand: 'BMW' }), true);
  assert.equal(matchesFilters(listing, { brand: 'Audi' }), false);
  assert.equal(matchesFilters(listing, { priceMax: 18000 }), false);
  assert.equal(matchesFilters(listing, { priceMax: 19000 }), true);
  assert.equal(matchesFilters(listing, { maxMileageKm: 50000 }), false);
  assert.equal(matchesFilters(listing, { fuelTypes: ['Diesel'] }), false);
  assert.equal(matchesFilters(listing, { fuelTypes: ['Petrol', 'Diesel'] }), true);
  assert.equal(matchesFilters(listing, { transmission: 'Any' }), true);
  // Unknown field on the listing is not grounds to drop it.
  assert.equal(matchesFilters({ brand: 'BMW' }, { priceMax: 1000 }), true);
});

// --- site input builders ----------------------------------------------------

test('mobile.de buildInput maps filters to actor input', () => {
  const input = mobilede.buildInput(
    { brand: 'BMW', model: '320i', priceMax: 20000, yearFrom: 2018, fuelTypes: ['Petrol'] },
    { actorId: 'x', maxResults: 30 }
  );
  assert.equal(input.make, 'BMW');
  assert.equal(input.model, '320i');
  assert.equal(input.priceTo, 20000);
  assert.equal(input.yearFrom, 2018);
  assert.equal(input.fuelType, 'Petrol');
  assert.equal(input.maxResults, 30);
});

test('startUrls passthrough overrides structured filters', () => {
  const input = mobilede.buildInput(
    { brand: 'BMW' },
    { startUrls: ['https://suchen.mobile.de/x'] }
  );
  assert.deepEqual(input.startUrls, [{ url: 'https://suchen.mobile.de/x' }]);
  assert.equal(input.make, undefined);
});

test('autoscout24 buildInput slugifies make/model and sets country', () => {
  const input = autoscout24.buildInput(
    { brand: 'Mercedes-Benz', model: 'C Class', priceMin: 5000 },
    { actorId: 'x', maxResults: 50, country: 'D' }
  );
  assert.equal(input.make, 'mercedes-benz');
  assert.equal(input.model, 'c-class');
  assert.equal(input.priceFrom, 5000);
  assert.equal(input.country, 'D');
});

test('autouncle buildInput builds a locale make/model path URL', () => {
  const input = autouncle.buildInput(
    { brand: 'fiat', model: 'panda' },
    { baseUrl: 'https://www.autouncle.de', listPath: '/de/gebrauchtwagen', maxPages: 2 }
  );
  assert.equal(input.startUrls[0].url, 'https://www.autouncle.de/de/gebrauchtwagen/Fiat/Panda');
  assert.equal(input.maxPages, 2);
});

// --- site output mappers ----------------------------------------------------

test('mobile.de mapItem normalises a raw dataset item', () => {
  const l = mobilede.mapItem(
    {
      id: 'm1',
      make: 'BMW',
      model: '320i',
      firstRegistration: '03/2019',
      mileage: '68.000 km',
      fuel: 'Benzin',
      gearbox: 'Automatik',
      price: '18.500 €',
      cubicCapacity: '1.998 cm³',
      co2: '132 g/km',
      images: [{ url: 'https://img/1.jpg' }],
      url: 'https://suchen.mobile.de/x',
    },
    2025
  );
  assert.equal(l.brand, 'BMW');
  assert.equal(l.year, 2019);
  assert.equal(l.mileageKm, 68000);
  assert.equal(l.fuelType, 'Petrol');
  assert.equal(l.transmission, 'Automatic');
  assert.equal(l.priceEur, 18500);
  assert.equal(l.displacementCm3, 1998);
  assert.equal(l.co2GKm, 132);
  assert.equal(l.emissionStandard, 'WLTP');
  assert.equal(l.thumbnailUrl, 'https://img/1.jpg');
  assert.equal(l.ageYears, 6);
});

test('autouncle mapItem reads its specific field names', () => {
  const l = autouncle.mapItem(
    {
      id: 'a1',
      make: 'Fiat',
      model: 'Panda',
      registrationDate: '2018',
      mileage: '95.000',
      engineFuel: 'Diesel',
      transmission: 'Manuale',
      priceValue: 16900,
      co2Emissions: 118,
      externalUrl: 'https://dealer/x',
    },
    2025
  );
  assert.equal(l.brand, 'Fiat');
  assert.equal(l.year, 2018);
  assert.equal(l.mileageKm, 95000);
  assert.equal(l.fuelType, 'Diesel');
  assert.equal(l.transmission, 'Manual');
  assert.equal(l.priceEur, 16900);
  assert.equal(l.url, 'https://dealer/x');
});
