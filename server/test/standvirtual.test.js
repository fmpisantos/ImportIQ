import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchUrl,
  extractNextData,
  parseListings,
  toComparable,
  fetchComparables,
} from '../src/adapters/direct/standvirtual.js';
import { comparisonCriteria } from '../src/adapters/ptMarketClient.js';

// Build an OTOMOTO-platform advert node in the documented shape.
function node({ url, title, price, model, year, mileage, fuel, gearbox, cv, cc }) {
  const parameters = [
    { key: 'model', value: model, displayValue: model },
    { key: 'first_registration_year', value: String(year) },
    { key: 'mileage', value: String(mileage), displayValue: `${mileage} km` },
    { key: 'fuel_type', value: fuel, displayValue: fuel },
    { key: 'gearbox', value: gearbox, displayValue: gearbox },
    { key: 'engine_power', value: `${cv} cv` },
    { key: 'engine_capacity', value: `${cc} cm3` },
  ];
  return { url, title, price: { amount: { units: String(price), currencyCode: 'EUR' } }, parameters };
}

// Wrap nodes in the urqlState __NEXT_DATA__ shape and a minimal HTML page.
function pageHtml(nodes) {
  const nextData = {
    props: {
      pageProps: {
        urqlState: {
          abc123: {
            data: JSON.stringify({
              advertSearch: { edges: nodes.map((n) => ({ node: n })) },
            }),
          },
        },
      },
    },
  };
  return `<!doctype html><html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    nextData
  )}</script></body></html>`;
}

const htmlFetch = (html) => async () => ({ ok: true, text: async () => html });

test('buildSearchUrl targets the brand path with the year + mileage window', () => {
  const criteria = comparisonCriteria({ year: 2013, mileageKm: 120000 });
  const url = buildSearchUrl({ brand: 'BMW' }, criteria, 1);
  assert.ok(url.startsWith('https://www.standvirtual.com/carros/bmw?'));
  assert.ok(url.includes('first_registration_year%3Afrom%5D=2012'));
  assert.ok(url.includes('first_registration_year%3Ato%5D=2014'));
  assert.ok(url.includes('mileage%3Afrom%5D=100000'));
  assert.ok(url.includes('mileage%3Ato%5D=140000'));
});

test('buildSearchUrl sends the model enum when a modelKey is given', () => {
  const criteria = comparisonCriteria({ year: 2013, mileageKm: 120000 });
  const url = buildSearchUrl({ brand: 'BMW' }, criteria, 1, { modelKey: '320' });
  assert.ok(url.includes('filter_enum_model%5D%5B0%5D=320'));
});

test('parseListings pulls advert nodes out of the urql cache', () => {
  const nodes = [node({ url: '/anuncio/a', price: 11900, model: '116', year: 2014, mileage: 90000, fuel: 'Diesel', gearbox: 'Manual', cv: 116, cc: 1995 })];
  const parsed = parseListings(extractNextData(pageHtml(nodes)));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].parameters.length, 7);
});

test('toComparable maps price/specs and converts cv → kW', () => {
  const c = toComparable(
    node({ url: '/anuncio/a', title: 'BMW 116 d', price: 11900, model: '116', year: 2014, mileage: 90000, fuel: 'Diesel', gearbox: 'Manual', cv: 116, cc: 1995 })
  );
  assert.equal(c.priceEur, 11900);
  assert.equal(c.url, 'https://www.standvirtual.com/anuncio/a');
  assert.equal(c.model, '116');
  assert.equal(c.fuel, 'Diesel');
  assert.equal(c.transmission, 'Manual');
  assert.equal(c.mileageKm, 90000);
  assert.equal(c.year, 2014);
  // The accented PT label is canonicalised (regression guard for the no-PT-avg bug).
  assert.equal(
    toComparable(node({ url: '/x', price: 1, model: '320', year: 2019, mileage: 1, fuel: 'Diesel', gearbox: 'Automática', cv: 190, cc: 1995 })).transmission,
    'Automatic'
  );
  assert.equal(c.displacementCm3, 1995);
  assert.equal(c.powerKw, Math.round(116 * 0.7355)); // 85
});

test('fetchComparables matches by model/fuel and drops out-of-window comparables', async () => {
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000, fuelType: 'Diesel' };
  const nodes = [
    node({ url: '/a', price: 11900, model: '116', year: 2014, mileage: 110000, fuel: 'Diesel', gearbox: 'Manual', cv: 116, cc: 1995 }), // keep
    node({ url: '/b', price: 9000, model: '116', year: 2013, mileage: 130000, fuel: 'Gasolina', gearbox: 'Manual', cv: 122, cc: 1598 }), // drop: petrol
    node({ url: '/c', price: 50990, model: 'M4', year: 2014, mileage: 60000, fuel: 'Gasolina', gearbox: 'Automática', cv: 431, cc: 2979 }), // drop: model
    node({ url: '/d', price: 6000, model: '116', year: 2009, mileage: 200000, fuel: 'Diesel', gearbox: 'Manual', cv: 116, cc: 1995 }), // drop: out of year window
  ];
  const out = await fetchComparables(listing, { fetchImpl: htmlFetch(pageHtml(nodes)), maxPages: 1 });
  assert.equal(out.source, 'standvirtual');
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].priceEur, 11900);
});

test('fetchComparables returns no items (and does not throw) when nothing parses', async () => {
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000 };
  const out = await fetchComparables(listing, {
    fetchImpl: async () => ({ ok: true, text: async () => '<html>no next data</html>' }),
    maxPages: 1,
  });
  assert.deepEqual(out.items, []);
});

test('fetchComparables propagates a first-page fetch failure', async () => {
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000 };
  await assert.rejects(
    fetchComparables(listing, {
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => '' }),
      maxPages: 1,
    }),
    /Standvirtual request failed \(403\)/
  );
});
