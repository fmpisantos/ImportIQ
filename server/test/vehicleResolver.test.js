import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVehicleIndex } from '../src/engine/vehicleMatch.js';
import { resolveVehicle } from '../src/engine/vehicleResolver.js';

// Small stand-in catalog so the unit test doesn't depend on the generated one.
const index = buildVehicleIndex([
  { brand: 'Volkswagen', aliases: ['vw'], models: { Golf: ['GTI', 'R'], Polo: [] } },
  { brand: 'BMW', aliases: ['bimmer'], models: { '1 Series': ['116i', '118d'], '3 Series': ['320d'] } },
]);

test('resolves a typo/alias brand to the canonical brand+model', () => {
  const r = resolveVehicle('vw', 'gold gti', { index });
  assert.equal(r.brand, 'Volkswagen');
  assert.equal(r.model, 'Golf');
  assert.ok(r.score >= 0.55);
});

test('resolves a designation model to its canonical catalog model (verbatim)', () => {
  const r = resolveVehicle('BMW', '320d Touring', { index });
  assert.equal(r.brand, 'BMW');
  assert.equal(r.model, '3 Series'); // catalog name, used verbatim downstream
});

test('returns null when nothing matches confidently', () => {
  const r = resolveVehicle('Acme', 'Spaceship 9000', { index });
  assert.equal(r, null);
});

test('returns null on empty input rather than guessing', () => {
  assert.equal(resolveVehicle('', '', { index }), null);
  assert.equal(resolveVehicle(null, null, { index }), null);
});

test('a high score floor can suppress a weak rename', () => {
  // brand-only "BMW" (no model) is below even the default floor; an explicit
  // floor of 1 rejects anything short of a perfect hit.
  assert.equal(resolveVehicle('BMW', '', { index }), null);
  assert.equal(resolveVehicle('vw', 'golf', { index, minScore: 1.01 }), null);
});
