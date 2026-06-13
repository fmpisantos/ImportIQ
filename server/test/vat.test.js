import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessVat, PT_VAT_RATE_PCT } from '../src/engine/vat.js';

test('VAT applies (and is computed) for a low-mileage "new" car', () => {
  const out = assessVat({ mileageKm: 3000, ageYears: 1, priceEur: 20000 });
  assert.equal(out.applicable, true);
  assert.equal(out.vatRatePct, PT_VAT_RATE_PCT);
  assert.equal(out.vatEur, 4600); // 23% of 20,000
  assert.ok(out.reasons.some((r) => r.includes('km')));
});

test('VAT applies for a known registration date ≤6 months old', () => {
  const out = assessVat({
    mileageKm: 9000,
    firstRegYear: 2026,
    firstRegMonth: 3,
    referenceYear: 2026,
    referenceMonth: 6,
    priceEur: 30000,
  });
  assert.equal(out.applicable, true); // 3 months
  assert.equal(out.vatEur, 6900);
});

test('VAT does not apply to a normal used car', () => {
  const out = assessVat({ mileageKm: 90000, ageYears: 5, priceEur: 20000 });
  assert.equal(out.applicable, false);
  assert.equal(out.suspect, false);
  assert.equal(out.vatEur, null);
});

test('VAT is flagged suspect when registered this year but the month is unknown', () => {
  const out = assessVat({ mileageKm: 12000, ageYears: 0, priceEur: 25000 });
  assert.equal(out.applicable, false); // can't confirm ≤6 months
  assert.equal(out.suspect, true);
  assert.equal(out.vatEur, null); // don't invent a number
  assert.ok(out.notes.length > 0);
});
