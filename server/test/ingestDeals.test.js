// End-to-end test of the batch ingestor (jobs/ingestDeals.js) over the REAL
// direct pipeline (AutoScout24 search + detail enrich + PT comparison), with the
// network stubbed via a fake global fetch. Covers the load-bearing guarantees:
//
//   • a run ingests new inventory into `deals`;
//   • skip-unchanged: a re-run touches freshness but does NOT recompute;
//   • config-version invalidation: a cost-config edit forces a recompute even
//     though the price is unchanged;
//   • §9 enrich track-and-retry: a failed detail fetch is stored enrich_pending,
//     a now-succeeding next run flips it to complete (and it is NOT skipped by
//     skip-unchanged), while a genuinely field-less detail page is terminal
//     source_missing and is never re-fetched;
//   • price-change recompute.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.IMPORTIQ_DB = join(mkdtempSync(join(tmpdir(), 'importiq-ingest-')), 'test.db');
process.env.DATA_SOURCE = 'direct';
process.env.PT_SOURCES = 'olx'; // keep Standvirtual out of the fake-fetch surface
process.env.INGEST_SORTS_PER_RUN = '1'; // one sort order per run → one search fetch
process.env.INGEST_MAX_RESULTS = '20'; // a single AS24 page
process.env.INGEST_REQUEST_DELAY_MS = '0';
process.env.INGEST_CONCURRENCY = '2';
for (const k of [
  'APIFY_TOKEN', 'MOBILEDE_USER', 'MOBILEDE_PASS', 'STANDVIRTUAL_TOKEN', 'OLX_API_KEY',
  'DIRECT_MAX_RESULTS', 'DIRECT_ENRICH_LIMIT', 'DIRECT_CACHE_TTL_MS', 'DIRECT_REQUEST_DELAY_MS',
]) {
  delete process.env[k];
}

const { runIngest } = await import('../src/jobs/ingestDeals.js');
const { getDb, getDeal, getDealsPage, updateCostConfig } = await import('../src/db.js');

// --- Fake AutoScout24 / OLX surface -----------------------------------------

// One full search card (CO₂ + displacement present). Being a diesel it still
// gets ONE detail fetch to resolve the particulate surcharge (hasParticleFilter).
const cardComplete = {
  id: 'a',
  url: '/angebote/a',
  vehicle: { make: 'BMW', model: '320d', engineDisplacementInCCM: 1995, fuel: 'Diesel', transmission: 'Automatik' },
  tracking: { firstRegistration: '2019', mileage: 90000, price: 20000, fuelType: 'Diesel' },
  vehicleDetails: [
    { iconName: 'speedometer', data: '140 kW (190 PS)' },
    { iconName: 'leaf', data: '120 g/km (komb.)' },
  ],
};
// A card missing CO₂ — needs a detail fetch (which fails on run 1, succeeds later).
const cardNeedsEnrich = {
  id: 'b',
  url: '/angebote/b',
  vehicle: { make: 'BMW', model: '320d', engineDisplacementInCCM: 1995, fuel: 'Diesel' },
  tracking: { firstRegistration: '2019', mileage: 80000, price: 19000, fuelType: 'Diesel' },
  vehicleDetails: [{ iconName: 'speedometer', data: '140 kW (190 PS)' }],
};
// A card whose detail page loads but never publishes CO₂ → terminal.
const cardTerminal = {
  id: 'c',
  url: '/angebote/c',
  vehicle: { make: 'BMW', model: '320d', engineDisplacementInCCM: 1995, fuel: 'Diesel' },
  tracking: { firstRegistration: '2019', mileage: 70000, price: 18000, fuelType: 'Diesel' },
  vehicleDetails: [{ iconName: 'speedometer', data: '140 kW (190 PS)' }],
};
const CARDS = [cardComplete, cardNeedsEnrich, cardTerminal];

const nextData = (obj) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script>`;
const html = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return body;
  },
  async json() {
    return JSON.parse(body);
  },
});

let detailBFails = true; // run 1: B's detail fetch is blocked; later runs succeed
const fetchCounts = { search: 0, detailA: 0, detailB: 0, detailC: 0, olx: 0 };
let realFetch;

before(() => {
  getDb();
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/angebote/a')) {
      // Diesel with card CO₂/displacement — detail fetch only resolves the
      // particulate surcharge. A DPF-equipped diesel ⇒ no surcharge.
      fetchCounts.detailA++;
      return html(200, nextData({ props: { pageProps: { listingDetails: { vehicle: { hasParticleFilter: true } } } } }));
    }
    if (u.includes('/angebote/b')) {
      fetchCounts.detailB++;
      if (detailBFails) return html(403, 'denied');
      return html(200, nextData({ props: { pageProps: { listingDetails: { vehicle: { co2emissionInGramPerKmWithFallback: { raw: 115 }, rawDisplacementInCCM: 1995, hasParticleFilter: true } } } } }));
    }
    if (u.includes('/angebote/c')) {
      fetchCounts.detailC++;
      return html(200, nextData({ props: { pageProps: { listingDetails: { vehicle: { rawDisplacementInCCM: 1995 } } } } }));
    }
    if (u.includes('autoscout24.de/lst')) {
      fetchCounts.search++;
      return html(200, nextData({ props: { pageProps: { listings: CARDS } } }));
    }
    if (u.includes('olx.pt')) {
      fetchCounts.olx++;
      return html(200, JSON.stringify({ data: [] })); // no PT comparables → saving stays null
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

const T1 = 1_700_000_000_000;
const silent = () => {};

// The tests below share state and run in order: each builds on the prior run.

test('run 1 ingests new inventory and classifies enrich status per car', async () => {
  await runIngest({ now: T1, log: silent });

  const a = getDeal('autoscout24:a');
  assert.ok(a, 'complete card was ingested');
  assert.equal(a.enrich_status, 'complete');
  assert.equal(a.incomplete, 0);
  assert.ok(a.total_landed_eur > 20000, 'a complete car has a real landed total');
  assert.equal(fetchCounts.detailB >= 1, true);

  const b = getDeal('autoscout24:b');
  assert.equal(b.enrich_status, 'enrich_pending', 'failed detail fetch → enrich_pending, not silently complete');
  assert.equal(b.incomplete, 1);
  assert.ok(String(b.missing_fields).includes('co2'));

  const c = getDeal('autoscout24:c');
  assert.equal(c.enrich_status, 'source_missing', 'detail loaded but no CO₂ → terminal');
  assert.equal(c.incomplete, 1);
});

test('run 2 skips the unchanged complete car but RETRIES the enrich_pending one', async () => {
  detailBFails = false; // B's detail page is reachable now
  const cBefore = fetchCounts.detailC;
  const T2 = T1 + 1000;

  await runIngest({ now: T2, log: silent });

  // A: unchanged + complete → touched, not recomputed (computed_at stays at T1).
  const a = getDeal('autoscout24:a');
  assert.equal(a.computed_at, T1, 'unchanged complete car is NOT recomputed');
  assert.equal(a.last_seen_at, T2, 'but its freshness is bumped');

  // B: was enrich_pending → not skipped → re-attempted → now complete.
  const b = getDeal('autoscout24:b');
  assert.equal(b.enrich_status, 'complete', 'enrich_pending is retried and resolves');
  assert.equal(b.incomplete, 0);
  assert.ok(b.total_landed_eur > 19000);
  assert.equal(b.computed_at, T2);

  // C: terminal → NOT re-queued and NOT re-fetched.
  const c = getDeal('autoscout24:c');
  assert.equal(c.enrich_status, 'source_missing');
  assert.equal(fetchCounts.detailC, cBefore, 'a source_missing car is never re-fetched');
});

test('run 3: a cost-config edit invalidates and recomputes even with unchanged price', async () => {
  const a0 = getDeal('autoscout24:a');
  // Raise the active transport amount by €400 → config version changes.
  updateCostConfig('transport.open_carrier', { amount_eur: 1000 }, '2026-01-01T00:00:00.000Z');
  const T3 = T1 + 2000;

  await runIngest({ now: T3, log: silent });

  const a1 = getDeal('autoscout24:a');
  assert.notEqual(a1.config_version, a0.config_version, 'stamped with the new config version');
  assert.equal(a1.computed_at, T3, 'recomputed despite unchanged price');
  assert.equal(
    Math.round(a1.total_landed_eur - a0.total_landed_eur),
    400,
    'the €400 transport increase flows into the stored total'
  );
});

test('run 4: a price change recomputes the deal', async () => {
  // Bust the AS24 search cache and drop B's price by €2,000.
  getDb().prepare("DELETE FROM listings_cache WHERE cache_key LIKE 'direct:autoscout24:%'").run();
  cardNeedsEnrich.tracking.price = 17000;
  const T4 = T1 + 3000;

  await runIngest({ now: T4, log: silent });

  const b = getDeal('autoscout24:b');
  assert.equal(b.price_eur, 17000, 'new price captured');
  assert.equal(b.computed_at, T4, 'recomputed on the price change');
});

test('the search store exposes the active deals for the UI to read', () => {
  const page = getDealsPage({ brand: 'BMW' }, { sort: 'landed', page: 1, pageSize: 50 });
  assert.ok(page.total >= 2, 'complete + now-complete cars are queryable');
  for (const r of page.results) assert.ok(r.listing?.id, 'each result is the stored computed object');
});
