import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveModel, mapListing } from '../src/adapters/direct/autoscout24.js';

test('deriveModel prefers the explicit model field', () => {
  assert.equal(deriveModel({ model: 'Kuga', modelGroup: 'Kuga', variant: 'Kuga SUV' }), 'Kuga');
});

test('deriveModel falls back to modelGroup when model is empty', () => {
  assert.equal(deriveModel({ model: null, modelGroup: 'Transit Custom' }), 'Transit Custom');
});

test('deriveModel recovers the model family from the variant (body words stripped)', () => {
  // The failure mode behind the petrol-van-vs-diesel-pickup bug: model + modelGroup
  // both empty on a stripped commercial-vehicle card, only `variant` survives.
  assert.equal(deriveModel({ variant: 'Transit Custom Kastenwagen' }), 'Transit Custom');
  assert.equal(deriveModel({ variant: 'Kuga SUV / Geländewagen' }), 'Kuga');
  assert.equal(deriveModel({ variant: 'Transit Courier Kasten' }), 'Transit Courier');
});

test('deriveModel returns null when nothing but a body word is available', () => {
  assert.equal(deriveModel({ variant: 'Kastenwagen' }), null);
  assert.equal(deriveModel({}), null);
});

test('mapListing recovers a model from variant when model/modelGroup are empty', () => {
  const card = {
    id: 'x1',
    url: '/angebote/ford-transit-courier-kasten-trend-benzin-weiss-cat_ma29-abc',
    vehicle: {
      make: 'Ford',
      model: null,
      modelGroup: null,
      variant: 'Transit Courier Kastenwagen',
      fuel: 'Benzin',
      transmission: 'Schaltgetriebe',
    },
    tracking: { firstRegistration: '2026', price: '22690' },
  };
  const listing = mapListing(card, 2026);
  assert.equal(listing.brand, 'Ford');
  assert.equal(listing.model, 'Transit Courier'); // recovered, not null
  assert.equal(listing.fuelType, 'Petrol');
  assert.equal(listing.transmission, 'Manual');
});

test('mapListing captures the registration MONTH from the card ("09-2008")', () => {
  const card = {
    id: 'm1',
    vehicle: { make: 'BMW', model: '320', fuel: 'Diesel' },
    tracking: { firstRegistration: '09-2008', price: '9000' },
  };
  const listing = mapListing(card, 2026);
  assert.equal(listing.firstRegYear, 2008);
  assert.equal(listing.firstRegMonth, 9); // was hardcoded null before
});

test('mapListing leaves firstRegMonth null when the card states only a year', () => {
  const card = {
    id: 'm2',
    vehicle: { make: 'BMW', model: '320', fuel: 'Diesel' },
    tracking: { firstRegistration: '2008', price: '9000' },
  };
  assert.equal(mapListing(card, 2026).firstRegMonth, null);
});
