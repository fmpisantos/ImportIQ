// Tests for the automated ISV-table refresh: number/bracket parsing, the HTML
// table parser, the validate-and-merge guardrail, and the runtime resolver.
import './helpers/tmpdb.js'; // isolate the SQLite store — MUST be first
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePtNumber,
  parseBracketMax,
  parseIsvTablesFromHtml,
  validateAndMerge,
} from '../src/adapters/isvTablesSource.js';
import { ENVIRONMENTAL_BRACKETS } from '../src/engine/isvTables.js';
import {
  getEnvironmentalBrackets,
  clearIsvTableCache,
  ISV_TABLES_CACHE_KEY,
} from '../src/engine/isvTableStore.js';
import { setCached } from '../src/db.js';

// --- HTML fixtures (mimic the real reference pages: <table> with section heads) ---

const htmlTable = (rows) =>
  '<table>' +
  rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') +
  '</table>';

const DIESEL_WLTP_ROWS = [
  ['Até 110', '1,72€', '11,50€'],
  ['111 a 120', '18,96€', '1.906,19€'],
  ['121 a 140', '65,04€', '7.360,85€'],
  ['141 a 150', '127,40€', '16.080,57€'],
  ['151 a 160', '160,81€', '21.176,06€'],
  ['161 a 170', '221,69€', '29.227,38€'],
  ['171 a 190', '274,08€', '36.987,98€'],
  ['Mais de 190', '282,35€', '38.271,32€'],
];
const DIESEL_NEDC_ROWS = [
  ['Até 79', '5,78€', '439,04€'],
  ['80 a 95', '23,45€', '1.848,58€'],
  ['96 a 120', '79,22€', '7.195,63€'],
  ['121 a 140', '175,73€', '18.924,92€'],
  ['141 a 160', '195,43€', '21.720,92€'],
  ['Mais de 160', '268,42€', '33.447,90€'],
];

const officialPage = () => `
  <h2>Gasóleo WLTP</h2>
  ${htmlTable(DIESEL_WLTP_ROWS)}
  <h2>Gasóleo NEDC</h2>
  ${htmlTable(DIESEL_NEDC_ROWS)}
`;

// --- parsePtNumber ---

test('parsePtNumber handles PT and EN formats', () => {
  assert.equal(parsePtNumber('1,72€'), 1.72);
  assert.equal(parsePtNumber('11,50€'), 11.5);
  assert.equal(parsePtNumber('1.906,19€'), 1906.19);
  assert.equal(parsePtNumber('38.271,32'), 38271.32);
  assert.equal(parsePtNumber('7,360.85'), 7360.85); // EN grouping
  assert.equal(parsePtNumber('500'), 500);
  assert.ok(Number.isNaN(parsePtNumber('Taxa')));
});

// --- parseBracketMax ---

test('parseBracketMax derives the upper bound', () => {
  assert.equal(parseBracketMax('Até 79'), 79);
  assert.equal(parseBracketMax('80 a 95'), 95);
  assert.equal(parseBracketMax('111 – 120'), 120);
  assert.equal(parseBracketMax('Mais de 190'), Infinity);
  // No digits → null (header cells like "CO2" still contain a digit and are
  // filtered later by the row parser's "needs two numeric cells" guard).
  assert.equal(parseBracketMax('Taxa por g/km'), null);
});

// --- parseIsvTablesFromHtml ---

test('parser extracts the diesel tables matching the baseline', () => {
  const parsed = parseIsvTablesFromHtml(officialPage());
  assert.deepEqual(parsed['diesel.WLTP'], ENVIRONMENTAL_BRACKETS['diesel.WLTP']);
  assert.deepEqual(parsed['diesel.NEDC'], ENVIRONMENTAL_BRACKETS['diesel.NEDC']);
});

// --- validateAndMerge ---

// A plausible "next year" diesel.WLTP: same shape, first rate nudged up. Still
// well above gasoline, so it passes the cross-fuel sanity check.
const bumpedDieselWltp = ENVIRONMENTAL_BRACKETS['diesel.WLTP'].map((b, i) =>
  i === 0 ? { ...b, ratePerGkm: 1.9 } : b
);

const sourceWith = (dieselWltp) => ({
  url: 'http://example/' + Math.round(dieselWltp[0].ratePerGkm * 100),
  tables: { 'diesel.WLTP': dieselWltp },
});

test('validateAndMerge applies a value two sources agree on', () => {
  const result = validateAndMerge(
    [sourceWith(bumpedDieselWltp), sourceWith(bumpedDieselWltp)],
    ENVIRONMENTAL_BRACKETS
  );
  assert.ok(result.accepted.includes('diesel.WLTP'));
  assert.equal(result.changed, true);
  assert.deepEqual(result.environmental['diesel.WLTP'], bumpedDieselWltp);
  // untouched keys fall through to the baseline
  assert.equal(result.environmental['gasoline.WLTP'], ENVIRONMENTAL_BRACKETS['gasoline.WLTP']);
});

test('validateAndMerge rejects when sources disagree, keeping the baseline', () => {
  const other = ENVIRONMENTAL_BRACKETS['diesel.WLTP'].map((b, i) =>
    i === 0 ? { ...b, ratePerGkm: 2.5 } : b
  );
  const result = validateAndMerge(
    [sourceWith(bumpedDieselWltp), sourceWith(other)],
    ENVIRONMENTAL_BRACKETS
  );
  assert.ok(!result.accepted.includes('diesel.WLTP'));
  assert.equal(result.changed, false);
  assert.deepEqual(result.environmental['diesel.WLTP'], ENVIRONMENTAL_BRACKETS['diesel.WLTP']);
  assert.ok(result.flags.some((f) => /disagree/.test(f)));
});

test('validateAndMerge rejects a structurally invalid table (no Infinity catch-all)', () => {
  const malformed = [
    { max: 110, ratePerGkm: 1.9, deduction: 11.5 },
    { max: 120, ratePerGkm: 18.96, deduction: 1906.19 }, // no Infinity bracket
  ];
  const result = validateAndMerge([sourceWith(malformed), sourceWith(malformed)], ENVIRONMENTAL_BRACKETS);
  assert.ok(!result.accepted.includes('diesel.WLTP'));
  assert.deepEqual(result.environmental['diesel.WLTP'], ENVIRONMENTAL_BRACKETS['diesel.WLTP']);
  assert.ok(result.flags.some((f) => /structural/.test(f)));
});

test('validateAndMerge rejects diesel that computes below gasoline', () => {
  // Agreed + structurally valid, but cheaper than gasoline → cross-fuel sanity fails.
  const tooCheap = [{ max: Infinity, ratePerGkm: 0.01, deduction: 0 }];
  const result = validateAndMerge([sourceWith(tooCheap), sourceWith(tooCheap)], ENVIRONMENTAL_BRACKETS);
  assert.ok(!result.accepted.includes('diesel.WLTP'));
  assert.deepEqual(result.environmental['diesel.WLTP'], ENVIRONMENTAL_BRACKETS['diesel.WLTP']);
  assert.ok(result.flags.some((f) => /below gasoline/.test(f)));
});

// --- resolver (engine/isvTableStore.js) ---

test('resolver returns the baseline when no override is cached', () => {
  clearIsvTableCache();
  assert.equal(getEnvironmentalBrackets(), ENVIRONMENTAL_BRACKETS);
});

test('resolver returns a validated cached override when present', () => {
  const environmental = { ...ENVIRONMENTAL_BRACKETS, 'diesel.WLTP': bumpedDieselWltp };
  setCached('refdata_cache', ISV_TABLES_CACHE_KEY, { version: 'TEST', environmental }, Date.now());
  clearIsvTableCache();
  const active = getEnvironmentalBrackets();
  assert.deepEqual(active['diesel.WLTP'], bumpedDieselWltp);
  clearIsvTableCache();
});
