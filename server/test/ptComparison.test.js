import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getComparisonCombined } from '../src/adapters/direct/ptComparison.js';
import { buildVehicleIndex } from '../src/engine/vehicleMatch.js';

// One fetchImpl that serves both sources, branching on the URL: OLX.pt hits its
// JSON API; Standvirtual returns an HTML page with __NEXT_DATA__.
function olxOffer({ price, url, modelo, combustivel }) {
  const params = [{ key: 'price', value: { value: price } }];
  if (modelo) params.push({ key: 'modelo', value: { key: modelo, label: modelo } });
  if (combustivel) params.push({ key: 'combustivel', value: { key: combustivel, label: combustivel } });
  return { url, title: modelo, params };
}

function svNode({ url, price, model, year, mileage, fuel }) {
  return {
    url,
    title: model,
    price: { amount: { units: String(price) } },
    parameters: [
      { key: 'model', value: model },
      { key: 'first_registration_year', value: String(year) },
      { key: 'mileage', value: String(mileage) },
      { key: 'fuel_type', value: fuel },
    ],
  };
}

function svHtml(nodes) {
  const nextData = {
    props: { pageProps: { urqlState: { h: { data: JSON.stringify({ advertSearch: { edges: nodes.map((n) => ({ node: n })) } }) } } } },
  };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`;
}

const LISTING = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000, fuelType: 'Diesel' };

test('getComparisonCombined merges comparables from both sources', async () => {
  const olxPayload = {
    data: [
      olxOffer({ price: 10000, url: 'https://olx.pt/a', modelo: '116', combustivel: 'diesel' }),
      olxOffer({ price: 11000, url: 'https://olx.pt/b', modelo: '116', combustivel: 'diesel' }),
    ],
  };
  const svPage = svHtml([
    svNode({ url: '/x', price: 12000, model: '116', year: 2013, mileage: 115000, fuel: 'Diesel' }),
    svNode({ url: '/y', price: 13000, model: '116', year: 2014, mileage: 110000, fuel: 'Diesel' }),
  ]);

  const fetchImpl = async (url) =>
    String(url).includes('olx.pt')
      ? { ok: true, json: async () => olxPayload }
      : { ok: true, text: async () => svPage };

  const out = await getComparisonCombined(LISTING, { sources: ['olx', 'standvirtual'], fetchImpl, maxPages: 1, resolve: false });

  assert.equal(out.sampleSize, 4); // 2 OLX + 2 Standvirtual
  assert.equal(out.avgPriceEur, 11500); // mean of 10/11/12/13k
  assert.equal(out.source, 'olx.pt + standvirtual');
  const bySource = Object.fromEntries(out.sources.map((s) => [s.source, s.sampleSize]));
  assert.equal(bySource['olx.pt'], 2);
  assert.equal(bySource.standvirtual, 2);
  assert.ok(out.searchUrl.includes('olx.pt')); // primary link prefers OLX
});

test('getComparisonCombined survives one source failing and reports it', async () => {
  const olxPayload = { data: [olxOffer({ price: 10000, url: 'https://olx.pt/a', modelo: '116', combustivel: 'diesel' })] };
  const fetchImpl = async (url) => {
    if (String(url).includes('olx.pt')) return { ok: true, json: async () => olxPayload };
    return { ok: false, status: 403, text: async () => 'blocked' }; // Standvirtual blocked
  };

  const out = await getComparisonCombined(LISTING, { sources: ['olx', 'standvirtual'], fetchImpl, maxPages: 1, resolve: false });

  assert.equal(out.sampleSize, 1); // only OLX contributed
  assert.equal(out.avgPriceEur, 10000);
  const sv = out.sources.find((s) => s.source === 'standvirtual');
  assert.equal(sv.sampleSize, 0);
  assert.ok(sv.error.includes('403'));
});

test('getComparisonCombined dedupes the same car appearing in two sources', async () => {
  const shared = 'https://dup.example/1';
  const olxPayload = { data: [olxOffer({ price: 10000, url: shared, modelo: '116', combustivel: 'diesel' })] };
  const svPage = svHtml([svNode({ url: shared, price: 10000, model: '116', year: 2013, mileage: 120000, fuel: 'Diesel' })]);
  const fetchImpl = async (url) =>
    String(url).includes('olx.pt')
      ? { ok: true, json: async () => olxPayload }
      : { ok: true, text: async () => svPage };

  const out = await getComparisonCombined(LISTING, { sources: ['olx', 'standvirtual'], fetchImpl, maxPages: 1, resolve: false });
  assert.equal(out.sampleSize, 1); // deduped by URL
});

test('getComparisonCombined dedupes a cross-posted car with DIFFERENT urls per source', () => {
  // A dealer cross-posts the same car to OLX and Standvirtual; each platform
  // mints its own URL, so URL-dedup alone would count it twice and inflate the
  // sample. The content fingerprint (price + trim title) must collapse them.
  const olxPayload = {
    data: [
      olxOffer({ price: 10000, url: 'https://olx.pt/uniq-a', modelo: '116', combustivel: 'diesel' }),
      olxOffer({ price: 22000, url: 'https://olx.pt/dup-olx', modelo: '116', combustivel: 'diesel' }),
    ],
  };
  const svPage = svHtml([
    svNode({ url: '/uniq-b', price: 11000, model: '116', year: 2013, mileage: 115000, fuel: 'Diesel' }),
    // same car as the €22000 OLX one: same title ("116") + price, different URL.
    svNode({ url: '/dup-sv', price: 22000, model: '116', year: 2013, mileage: 116000, fuel: 'Diesel' }),
  ]);
  const fetchImpl = async (url) =>
    String(url).includes('olx.pt')
      ? { ok: true, json: async () => olxPayload }
      : { ok: true, text: async () => svPage };

  return getComparisonCombined(LISTING, { sources: ['olx', 'standvirtual'], fetchImpl, maxPages: 1, resolve: false }).then(
    (out) => {
      assert.equal(out.sampleSize, 3); // 2 unique + 1 cross-posted dup collapsed
    }
  );
});

test('getComparisonCombined searches PT under the canonical (matched) brand+model', async () => {
  // The card shows a typo'd brand and a designation model; the fuzzy matcher
  // resolves it to the catalog identity, and PT is searched for THAT car.
  const index = buildVehicleIndex([
    { brand: 'Volkswagen', aliases: ['vw'], models: { Golf: ['GTI'], Polo: [] } },
  ]);
  const typed = { brand: 'vw', model: 'gold gti', year: 2019, mileageKm: 60000, fuelType: 'Petrol' };

  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return String(url).includes('olx.pt')
      ? { ok: true, json: async () => ({ data: [] }) }
      : { ok: true, text: async () => svHtml([]) };
  };

  const out = await getComparisonCombined(typed, {
    sources: ['olx', 'standvirtual'],
    fetchImpl,
    maxPages: 1,
    index, // resolve against the stub catalog, not the generated one
  });

  // The matched identity is surfaced for the UI…
  assert.deepEqual(
    { brand: out.resolvedVehicle.brand, model: out.resolvedVehicle.model },
    { brand: 'Volkswagen', model: 'Golf' }
  );
  // …and it — not the raw "vw"/"gold gti" — is what drove the PT queries.
  const olxUrl = urls.find((u) => u.includes('olx.pt'));
  const svUrl = urls.find((u) => !u.includes('olx.pt'));
  assert.ok(olxUrl.includes('query=Golf'), `OLX query should be the canonical model: ${olxUrl}`);
  assert.ok(svUrl.includes('/carros/volkswagen'), `SV should search the canonical brand: ${svUrl}`);
  assert.ok(svUrl.toLowerCase().includes('golf'), `SV should narrow to the canonical model: ${svUrl}`);
});

test('getComparisonCombined refuses to compare (and does not fetch) when the model is unknown', async () => {
  // A commercial-vehicle card with no model would otherwise match brand+year
  // only — a small van vs pickups. The trust gate must short-circuit.
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    return { ok: true, json: async () => ({ data: [] }), text: async () => '' };
  };
  const noModel = { brand: 'Ford', model: null, year: 2026, mileageKm: 10, fuelType: 'Petrol' };

  const out = await getComparisonCombined(noModel, { sources: ['olx', 'standvirtual'], fetchImpl, maxPages: 1, resolve: false });

  assert.equal(fetched, false, 'must not hit any PT source without a model');
  assert.equal(out.reliable, false);
  assert.equal(out.unreliableReason, 'model-unknown');
  assert.equal(out.sampleSize, 0);
  assert.equal(out.marketValueEur, null);
  assert.deepEqual(out.sources, []);
});
