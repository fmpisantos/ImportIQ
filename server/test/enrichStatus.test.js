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

test('a listing already carrying every ISV field (incl. particle info) is complete WITHOUT a fetch', async () => {
  // Diesel, so particle info is part of "fully known" — provide it so no detail
  // fetch is needed to resolve the particulate surcharge.
  const r = await enrichListing(
    { ...combustion, co2GKm: 120, particleEmissionsGKm: 0 },
    { fetchImpl: throwFetch }
  );
  assert.equal(r.enrichStatus, 'complete');
  assert.deepEqual(r.missingFields, []);
});

test('a petrol car with CO₂ + displacement is complete WITHOUT a fetch (no particle refinement)', async () => {
  const r = await enrichListing(
    { fuelType: 'Petrol', displacementCm3: 1498, co2GKm: 130, url: combustion.url },
    { fetchImpl: throwFetch }
  );
  assert.equal(r.enrichStatus, 'complete');
});

test('a diesel with CO₂ but no particle info FETCHES the detail page and reads hasParticleFilter', async () => {
  // Costable already (CO₂ + displacement), but the €500 particulate surcharge is
  // only knowable from the detail page → a fetch is triggered to refine it.
  const noFilter = await enrichListing(
    { ...combustion, co2GKm: 120 },
    { fetchImpl: () => resp(200, detailHtml({ hasParticleFilter: false })) }
  );
  assert.equal(noFilter.enrichStatus, 'complete');
  assert.ok(noFilter.listing.particleEmissionsGKm >= 0.001, 'no DPF → above the surcharge threshold');

  const withFilter = await enrichListing(
    { ...combustion, co2GKm: 120 },
    { fetchImpl: () => resp(200, detailHtml({ hasParticleFilter: true })) }
  );
  assert.equal(withFilter.listing.particleEmissionsGKm, 0, 'DPF → no surcharge');
});

test('a PHEV missing electric range FETCHES the detail page and qualifies for the reduced regime', async () => {
  const phev = { fuelType: 'Plug-in Hybrid', displacementCm3: 1395, co2GKm: 30, url: combustion.url };
  const r = await enrichListing(phev, {
    fetchImpl: () => resp(200, detailHtml({ electricRangeWithFallback: { raw: 60 } })),
  });
  assert.equal(r.listing.electricRangeKm, 60);
  assert.equal(r.listing.qualifiesForEvRegime, true, '≥50 km range and <50 g/km CO₂ → reduced ISV');
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
