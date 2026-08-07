import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILTER_BRANDS, SWEEP_BRANDS } from '../src/adapters/brands.js';
import { brandKey, brandSpellings, matchesFilters } from '../src/adapters/normalize.js';
import { loadVehicleCatalog, overlayCurated } from '../src/data/vehicleCatalog.loader.js';

// The filter dropdown and the fuzzy matcher must be backed by the same catalog:
// anything the user can pick has to be something the matcher can resolve.

test('filter brands cover the premium/niche marques, not just the mass market', () => {
  const expected = [
    'Porsche', 'Ferrari', 'Lamborghini', 'Maserati', 'Aston Martin', 'Bentley',
    'McLaren', 'Rolls-Royce', 'Alpina', 'Alpine', 'Abarth', 'Lotus', 'Subaru',
    'MG', 'BYD', 'Genesis', 'Lancia', 'Saab', 'Maybach', 'SsangYong', 'Infiniti',
  ];
  for (const brand of expected) {
    assert.ok(FILTER_BRANDS[brand], `missing filter brand ${brand}`);
    assert.ok(FILTER_BRANDS[brand].length > 0, `${brand} has no models`);
  }
  assert.ok(Object.keys(FILTER_BRANDS).length >= 50);
});

test('filter brands list models the source sites actually carry', () => {
  assert.ok(FILTER_BRANDS.Porsche.includes('911'));
  assert.ok(FILTER_BRANDS.Porsche.includes('Macan'));
  assert.ok(FILTER_BRANDS.Porsche.includes('Taycan'));
  // …and none of the Wikidata pre-war noise the generated catalog carries.
  assert.ok(!FILTER_BRANDS.Peugeot.some((m) => /^Type \d/.test(m)));
});

test('every filterable brand is resolvable by the matcher', () => {
  const { catalog } = loadVehicleCatalog();
  const known = new Set(catalog.map((b) => brandKey(b.brand)));
  for (const brand of Object.keys(FILTER_BRANDS)) {
    assert.ok(known.has(brandKey(brand)), `matcher does not know ${brand}`);
  }
});

test('the curated seed overlays onto the generated catalog', () => {
  const base = [{ brand: 'Porsche', aliases: [], models: { 911: [], Boxster: [] } }];
  const merged = overlayCurated(base, [
    { brand: 'porsche', aliases: ['porshe'], models: { 911: ['Turbo S'], Taycan: ['4S'] } },
    { brand: 'Alpina', models: { B3: ['Touring'] } },
  ]);

  const porsche = merged.find((b) => b.brand === 'Porsche');
  assert.deepEqual(porsche.aliases, ['porshe']);
  assert.deepEqual(porsche.models['911'], ['Turbo S']); // curated submodels win
  assert.deepEqual(porsche.models.Boxster, []); // generated-only model kept
  assert.deepEqual(porsche.models.Taycan, ['4S']); // curated-only model added
  assert.ok(merged.some((b) => b.brand === 'Alpina')); // curated-only brand added
});

test('the ingest sweep stays on the popular core, not the whole filter list', () => {
  assert.ok(SWEEP_BRANDS.length <= 15);
  for (const brand of SWEEP_BRANDS) {
    assert.ok(FILTER_BRANDS[brand], `sweep brand ${brand} is not filterable`);
  }
});

test('brand matching folds accents and separators', () => {
  assert.equal(brandKey('Škoda'), brandKey('Skoda'));
  assert.equal(brandKey('Citroën'), brandKey('Citroen'));
  assert.equal(brandKey('Mercedes-Benz'), brandKey('Mercedes Benz'));
  assert.notEqual(brandKey('Audi'), brandKey('Opel'));

  // A "Škoda" pick must not drop AutoScout24's "Skoda"-spelled listings.
  assert.ok(matchesFilters({ brand: 'Skoda', model: 'Octavia' }, { brand: 'Škoda' }));
  assert.ok(matchesFilters({ brand: 'Citroen', model: 'C3' }, { brand: 'Citroën' }));
  assert.ok(!matchesFilters({ brand: 'Audi', model: 'A4' }, { brand: 'Škoda' }));
});

test('brandSpellings enumerates the forms a source may have stored', () => {
  const skoda = brandSpellings('Škoda');
  assert.ok(skoda.includes('škoda'));
  assert.ok(skoda.includes('skoda'));

  const mercedes = brandSpellings('Mercedes-Benz');
  assert.ok(mercedes.includes('mercedes-benz'));
  assert.ok(mercedes.includes('mercedes benz'));
  assert.ok(mercedes.includes('mercedesbenz'));

  assert.deepEqual(brandSpellings(''), []);
});
