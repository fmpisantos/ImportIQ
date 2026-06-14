// §9 enrichment-status classification (the core of the track-and-retry fix) and
// the sweep sort-order URL building. `enrichListing` must distinguish a failed
// detail fetch (enrich_pending, retry next run) from a detail page that simply
// omits the field (source_missing, terminal) — so the batch never re-hammers a
// car the source will never describe, yet never permanently loses a car to a
// transient blip. Pure: fetch is injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichListing, buildSearchUrl } from '../src/adapters/direct/autoscout24.js';

const resp = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return body;
  },
});
const detailHtml = (vehicle) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { listingDetails: { vehicle } } },
  })}</script>`;

const combustion = { fuelType: 'Diesel', displacementCm3: 1995, url: 'https://www.autoscout24.de/angebote/x' };
const throwFetch = () => {
  throw new Error('fetch should not be called');
};

test('a listing already carrying every ISV field is complete WITHOUT a fetch', async () => {
  const r = await enrichListing({ ...combustion, co2GKm: 120 }, { fetchImpl: throwFetch });
  assert.equal(r.enrichStatus, 'complete');
  assert.deepEqual(r.missingFields, []);
});

test('an EV needs no CO₂/displacement → complete without a fetch', async () => {
  const r = await enrichListing(
    { fuelType: 'Electric', co2GKm: null, displacementCm3: null, url: combustion.url },
    { fetchImpl: throwFetch }
  );
  assert.equal(r.enrichStatus, 'complete');
});

test('a missing-field listing with no detail URL is terminal source_missing (no retry)', async () => {
  const r = await enrichListing(
    { fuelType: 'Diesel', displacementCm3: 1995, co2GKm: null, url: null },
    { fetchImpl: throwFetch }
  );
  assert.equal(r.enrichStatus, 'source_missing');
  assert.deepEqual(r.missingFields, ['listing.co2GKm']);
});

test('a failed detail fetch → enrich_pending (retry next run), original fields kept', async () => {
  const r = await enrichListing({ ...combustion, co2GKm: null }, { fetchImpl: () => resp(403, 'denied') });
  assert.equal(r.enrichStatus, 'enrich_pending');
  assert.equal(r.listing.co2GKm, null);
});

test('a detail page with no parseable __NEXT_DATA__ → enrich_pending (transient)', async () => {
  const r = await enrichListing(
    { ...combustion, co2GKm: null },
    { fetchImpl: () => resp(200, '<html>no next data here</html>') }
  );
  assert.equal(r.enrichStatus, 'enrich_pending');
});

test('a detail page that loads but omits CO₂ → source_missing (terminal)', async () => {
  const r = await enrichListing(
    { ...combustion, co2GKm: null },
    { fetchImpl: () => resp(200, detailHtml({ rawDisplacementInCCM: 1995 })) } // no co2 field
  );
  assert.equal(r.enrichStatus, 'source_missing');
  assert.deepEqual(r.missingFields, ['listing.co2GKm']);
});

test('a detail page that supplies the missing CO₂ → complete', async () => {
  const r = await enrichListing(
    { ...combustion, co2GKm: null },
    {
      fetchImpl: () =>
        resp(200, detailHtml({ co2emissionInGramPerKmWithFallback: { raw: 115 }, rawDisplacementInCCM: 1995 })),
    }
  );
  assert.equal(r.enrichStatus, 'complete');
  assert.equal(r.listing.co2GKm, 115);
});

test('buildSearchUrl defaults to the standard order, and honours sweep sort/desc', () => {
  const dflt = new URL(buildSearchUrl({}));
  assert.equal(dflt.searchParams.get('sort'), 'standard');
  assert.equal(dflt.searchParams.get('desc'), '0');

  const swept = new URL(buildSearchUrl({}, { sort: 'price', desc: 1 }));
  assert.equal(swept.searchParams.get('sort'), 'price');
  assert.equal(swept.searchParams.get('desc'), '1');
});
