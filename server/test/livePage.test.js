// Live-scrape pagination over the REAL direct pipeline, network stubbed via a
// fake global fetch. Covers the two fixes:
//
//   • honest counts — searchListingsDirectPage reports the *reachable* total
//     (clamped to AS24's 20-page/400-card cap) plus AS24's raw count as
//     `totalAvailable`, so the UI can say "first 400 of 1,234".
//   • global computed-sort — searchListingsPagedComputed ranks the WHOLE
//     reachable pool by a computed key (saving/margin/landed), so the best deals
//     surface on page 1 instead of only being re-sorted within a page. Page 2 is
//     served from the 12h ranked-pool cache (no re-scrape). Incomplete listings
//     (null key) sort last; a per-car cost failure never sinks the page.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.IMPORTIQ_DB = join(mkdtempSync(join(tmpdir(), 'importiq-livepage-')), 'test.db');
process.env.DATA_SOURCE = 'direct';
process.env.PT_SOURCES = 'olx'; // keep Standvirtual off the fake-fetch surface
process.env.DIRECT_REQUEST_DELAY_MS = '0';
for (const k of [
  'APIFY_TOKEN', 'MOBILEDE_USER', 'MOBILEDE_PASS', 'STANDVIRTUAL_TOKEN', 'OLX_API_KEY',
  'DIRECT_MAX_RESULTS', 'DIRECT_ENRICH_LIMIT', 'DIRECT_CACHE_TTL_MS',
]) {
  delete process.env[k];
}

const { getDb } = await import('../src/db.js');
const { searchListingsPaged, searchListingsPagedComputed } = await import('../src/adapters/source.js');

// --- Fake AutoScout24 surface -----------------------------------------------

// A complete petrol card (CO₂ + displacement on the card ⇒ no detail fetch).
const card = (id, price) => ({
  id,
  url: `/angebote/${id}`,
  vehicle: { make: 'BMW', model: '320i', engineDisplacementInCCM: 1998, fuel: 'Benzin', transmission: 'Automatik' },
  tracking: { firstRegistration: '2019', mileage: 60000, price, fuelType: 'Benzin' },
  vehicleDetails: [
    { iconName: 'speedometer', data: '135 kW (184 PS)' },
    { iconName: 'leaf', data: '130 g/km (komb.)' },
  ],
});

const nextData = (obj) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script>`;
const html = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() { return body; },
  async json() { return JSON.parse(body); },
});

const pageParam = (u) => Number(new URL(u, 'https://x').searchParams.get('page')) || 1;

// Five cards; their stub price is irrelevant to the sort — the test's costOne
// assigns savings explicitly so the ranked order differs from listing order.
const POOL = [card('a', 20000), card('b', 21000), card('c', 22000), card('d', 23000), card('e', 24000)];

// Stub knobs the tests flip.
let searchBody = { listings: POOL, numberOfResults: 1234, numberOfPages: 200 };
const counts = { lst: 0, detail: 0, olx: 0 };
let realFetch;

before(() => {
  getDb();
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/angebote/')) { counts.detail++; return html(200, nextData({ props: { pageProps: { listingDetails: { vehicle: {} } } } })); }
    if (u.includes('autoscout24.de/lst')) {
      counts.lst++;
      // Cards only on page 1; later pages empty so pagination stops promptly.
      const listings = pageParam(u) === 1 ? searchBody.listings : [];
      return html(200, nextData({ props: { pageProps: { ...searchBody, listings } } }));
    }
    if (u.includes('olx.pt')) { counts.olx++; return html(200, JSON.stringify({ data: [] })); }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
});

after(() => { globalThis.fetch = realFetch; });

const T = 1_700_000_000_000;

test('searchListingsDirectPage clamps totalResults to reachable and exposes totalAvailable', async () => {
  searchBody = { listings: POOL, numberOfResults: 1234, numberOfPages: 200 };
  const res = await searchListingsPaged({}, { now: T, page: 1, pageSize: 50 });
  // pageSize 50 → 3 native pages/UI page; reachable = min(20,200)=20 pages.
  assert.equal(res.totalPages, Math.ceil(20 / 3)); // 7
  assert.equal(res.totalResults, 20 * 20); // 400 reachable cap, not 1234
  assert.equal(res.totalAvailable, 1234); // AS24's raw match count preserved
});

test('computed sort ranks the whole pool globally and pages from cache', async () => {
  searchBody = { listings: POOL, numberOfResults: 5, numberOfPages: 1 };
  // Saving by id, deliberately NOT in listing order — best deal is 'd'.
  const savings = { a: 100, b: 500, c: 300, d: 900, e: 700 };
  const costOne = async (l) => ({ listing: l, savingEur: savings[l.id], totalLandedCostEur: 1, incomplete: false });
  const sortValue = (r) => r.savingEur;

  const lstBefore = counts.lst;
  const p1 = await searchListingsPagedComputed({}, {
    now: T, page: 1, pageSize: 2, sort: 'saving', desc: 1, configVersion: 'v1', costOne, sortValue,
  });
  assert.equal(p1.total, 5);
  assert.equal(p1.totalPages, 3);
  assert.deepEqual(p1.results.map((r) => r.listing.id), ['d', 'e']); // globally top 2
  assert.equal(p1.totalAvailable, 5);
  const lstAfterP1 = counts.lst;
  assert.ok(lstAfterP1 > lstBefore, 'page 1 scrapes');

  // Page 2 of the same ranked pool — served from the 12h computed cache.
  const p2 = await searchListingsPagedComputed({}, {
    now: T, page: 2, pageSize: 2, sort: 'saving', desc: 1, configVersion: 'v1', costOne, sortValue,
  });
  assert.deepEqual(p2.results.map((r) => r.listing.id), ['b', 'c']); // continues the order (500 > 300)
  assert.equal(counts.lst, lstAfterP1, 'page 2 is a cache hit — no re-scrape');
});

test('incomplete listings (null sort key) sort last regardless of direction', async () => {
  searchBody = { listings: POOL, numberOfResults: 5, numberOfPages: 1 };
  // 'c' has no saving (e.g. PT comparison failed) → must sink even with desc.
  const savings = { a: 100, b: 500, c: null, d: 900, e: 700 };
  const costOne = async (l) => ({ listing: l, savingEur: savings[l.id], incomplete: savings[l.id] == null });
  const p = await searchListingsPagedComputed({}, {
    now: T, page: 1, pageSize: 5, sort: 'saving', desc: 1, configVersion: 'nulls', costOne, sortValue: (r) => r.savingEur,
  });
  assert.deepEqual(p.results.map((r) => r.listing.id), ['d', 'e', 'b', 'a', 'c']);
  assert.equal(p.results.at(-1).listing.id, 'c'); // null always last
});

test('a per-car cost failure (swallowed by costOne) does not sink the page', async () => {
  searchBody = { listings: POOL, numberOfResults: 5, numberOfPages: 1 };
  // Mirrors the route's costOne: a thrown PT lookup is caught → null comparison.
  const costOne = async (l) => {
    try {
      if (l.id === 'b') throw new Error('PT lookup blew up');
      return { listing: l, savingEur: Number(l.tracking?.price ?? 0) };
    } catch {
      return { listing: l, savingEur: null, incomplete: true };
    }
  };
  const p = await searchListingsPagedComputed({}, {
    now: T, page: 1, pageSize: 5, sort: 'saving', desc: 1, configVersion: 'resi', costOne, sortValue: (r) => r.savingEur,
  });
  assert.equal(p.total, 5, 'all five listings still present');
  assert.equal(p.results.at(-1).listing.id, 'b', 'the failed one sinks but is not dropped');
});
