import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadVehicleCatalog } from '../src/data/vehicleCatalog.loader.js';
import { buildVehicleIndex, matchVehicle, normalizeStr } from '../src/engine/vehicleMatch.js';

// Guards the catalog built from public datasets (US year-indexed set + Wikidata,
// overlaid with the curated seed). Asserts breadth and that representative 2010+
// models — especially the European marques the US-only datasets omit — are present
// and resolve through the matcher. Falls back to the curated seed if the generated
// file hasn't been built; breadth assertions only apply to the generated catalog.
const { catalog, source } = loadVehicleCatalog();
const index = buildVehicleIndex(catalog);

const findBrand = (name) => catalog.find((b) => normalizeStr(b.brand) === normalizeStr(name));
const hasModel = (brand, model) => {
  const b = findBrand(brand);
  return !!b && Object.keys(b.models).some((m) => normalizeStr(m) === normalizeStr(model));
};

test('catalog has broad brand + model coverage', { skip: source !== 'generated' }, () => {
  assert.ok(catalog.length >= 40, `expected ≥40 brands, got ${catalog.length}`);
  const models = catalog.reduce((n, b) => n + Object.keys(b.models).length, 0);
  assert.ok(models >= 800, `expected ≥800 models, got ${models}`);
});

test('European marques the US datasets omit are present with 2010+ models', () => {
  // brand, representative recent (2010+) model
  const expected = [
    ['Opel', 'Corsa'], ['Opel', 'Astra'], ['Opel', 'Mokka'],
    ['Peugeot', '208'], ['Peugeot', '3008'],
    ['Citroën', 'C3'], ['Renault', 'Clio'], ['Renault', 'Captur'],
    ['Škoda', 'Octavia'], ['SEAT', 'Leon'], ['Dacia', 'Duster'],
  ];
  for (const [brand, model] of expected) {
    assert.ok(hasModel(brand, model), `missing ${brand} ${model}`);
  }
});

test('global brands include EU-only models via the curated overlay', () => {
  assert.ok(hasModel('Volkswagen', 'Polo'), 'missing VW Polo');
  assert.ok(hasModel('Volkswagen', 'Golf'), 'missing VW Golf');
  assert.ok(hasModel('Volkswagen', 'ID.3'), 'missing VW ID.3');
});

test('representative queries resolve to the right brand + model', () => {
  const cases = [
    ['opel corsa 1.2', 'Opel', 'Corsa'],
    ['peugeot 3008 hybrid', 'Peugeot', '3008'],
    ['renault clio', 'Renault', 'Clio'],
    ['vw polo gti', 'Volkswagen', 'Polo'],
    ['tesla model 3', 'Tesla', 'Model 3'],
    ['bmw 320d touring', 'BMW', '3 Series'],
    ['mercedez c220 amg 2019', 'Mercedes-Benz', 'C-Class'],
  ];
  for (const [q, brand, model] of cases) {
    const top = matchVehicle(q, index, { limit: 1 })[0];
    assert.equal(top.brand, brand, `${q} → brand`);
    assert.equal(normalizeStr(top.model), normalizeStr(model), `${q} → model (got ${top.model})`);
  }
});
