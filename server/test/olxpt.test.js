import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchUrl,
  getComparisonDirect,
  brandCategoryId,
  normalizeModelKey,
} from '../src/adapters/direct/olxpt.js';

// Build an OLX offer in the public-API shape, with structured `params`.
function offer({ price, url, title, modelo, combustivel, gearbox }) {
  const params = [{ key: 'price', value: { value: price } }];
  if (modelo !== undefined) params.push({ key: 'modelo', value: { key: modelo, label: modelo } });
  if (combustivel !== undefined)
    params.push({ key: 'combustivel', value: { key: combustivel, label: combustivel } });
  if (gearbox !== undefined) params.push({ key: 'gearbox', value: { key: gearbox, label: gearbox } });
  return { url, title, params };
}

const okFetch = (payload) => async () => ({ ok: true, json: async () => payload });

const CRITERIA = { yearRange: [2018, 2020], mileageRangeKm: [44000, 84000] };

test('buildSearchUrl produces the brand + model web search URL', () => {
  const url = buildSearchUrl(CRITERIA, '320i', 'bmw');
  assert.equal(
    url,
    'https://www.olx.pt/carros-motos-e-barcos/carros/bmw/q-320i/' +
      '?search%5Bfilter_float_year%3Afrom%5D=2018&search%5Bfilter_float_year%3Ato%5D=2020' +
      '&search%5Bfilter_float_quilometros%3Afrom%5D=44000&search%5Bfilter_float_quilometros%3Ato%5D=84000'
  );
});

test('buildSearchUrl falls back to the cars root without a brand slug', () => {
  const url = buildSearchUrl(CRITERIA, undefined, undefined);
  assert.ok(url.startsWith('https://www.olx.pt/carros-motos-e-barcos/carros/?search'));
});

test('buildSearchUrl URL-encodes the model query segment', () => {
  const url = buildSearchUrl(CRITERIA, 'Série 3', 'bmw');
  assert.ok(url.includes('/q-S%C3%A9rie%203/'));
});

test('getComparisonDirect attaches the searchUrl using the response brand slug', async () => {
  const payload = {
    data: [
      {
        url: 'https://www.olx.pt/d/anuncio/golf-1.html',
        title: 'VW Golf 1.6 TDI',
        params: [{ key: 'price', value: { value: 17500 } }],
      },
    ],
    metadata: {
      adverts: { config: { targeting: { cat_l2_path: 'volkswagen-vw' } } },
    },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => payload });
  const listing = { brand: 'Volkswagen', model: 'Golf', year: 2019, mileageKm: 64000 };

  const out = await getComparisonDirect(listing, { fetchImpl });
  assert.equal(out.avgPriceEur, 17500);
  assert.deepEqual(out.sampleListings, [
    { priceEur: 17500, url: 'https://www.olx.pt/d/anuncio/golf-1.html', title: 'VW Golf 1.6 TDI' },
  ]);
  assert.ok(
    out.searchUrl.startsWith('https://www.olx.pt/carros-motos-e-barcos/carros/volkswagen-vw/q-Golf/')
  );
});

test('getComparisonDirect falls back to the cars root when metadata is absent', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: [] }) });
  const listing = { brand: 'BMW', model: '320i', year: 2019, mileageKm: 64000 };

  const out = await getComparisonDirect(listing, { fetchImpl });
  // "320i" → family key "320" for the free-text query (post-filter narrows fuel).
  assert.ok(out.searchUrl.startsWith('https://www.olx.pt/carros-motos-e-barcos/carros/q-320/'));
});

test('brandCategoryId resolves aliases and falls back to the cars root', () => {
  assert.equal(brandCategoryId('Volkswagen'), 777);
  assert.equal(brandCategoryId('Citroën'), 727);
  assert.equal(brandCategoryId('NotABrand'), 378);
});

test('normalizeModelKey strips a fuel/trim suffix off numeric model codes', () => {
  assert.equal(normalizeModelKey('320d'), '320');
  assert.equal(normalizeModelKey('116i'), '116');
  assert.equal(normalizeModelKey('118d'), '118');
  // Word- and letter-led models are left intact.
  assert.equal(normalizeModelKey('Golf'), 'Golf');
  assert.equal(normalizeModelKey('A4'), 'A4');
  assert.equal(normalizeModelKey('Série 3'), 'Série 3');
});

test('getComparisonDirect post-filters non-comparable models out of the average', async () => {
  // The inflated-average bug: a free-text "116" search drags in an M4 etc.
  const payload = {
    data: [
      offer({ price: 9000, url: 'a', title: '116', modelo: '116' }),
      offer({ price: 11000, url: 'b', title: '116i', modelo: '116' }),
      offer({ price: 50990, url: 'c', title: 'M4', modelo: 'M4' }),
      offer({ price: 28000, url: 'd', title: 'X3', modelo: 'X3' }),
    ],
  };
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000 };
  const out = await getComparisonDirect(listing, { fetchImpl: okFetch(payload) });
  assert.equal(out.sampleSize, 2); // only the two 116s
  assert.equal(out.avgPriceEur, 10000);
});

test('getComparisonDirect narrows by fuel on returned params and in the query', async () => {
  const payload = {
    data: [
      offer({ price: 10000, url: 'a', modelo: '116', combustivel: 'gasolina' }),
      offer({ price: 12000, url: 'b', modelo: '116', combustivel: 'diesel' }),
    ],
  };
  let calledUrl;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => payload };
  };
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000, fuelType: 'Petrol' };
  const out = await getComparisonDirect(listing, { fetchImpl });
  // Petrol → gasolina enum filter sent on the API request.
  assert.ok(calledUrl.includes('filter_enum_combustivel%5B0%5D=gasolina'));
  // The diesel 116 is dropped by the defensive post-filter.
  assert.equal(out.sampleSize, 1);
  assert.equal(out.avgPriceEur, 10000);
  assert.equal(out.matchedCriteria.fuelType, 'Petrol');
});

test('getComparisonDirect keeps comparables that are missing a structured field', async () => {
  const payload = {
    data: [
      offer({ price: 10000, url: 'a', modelo: '116' }), // no combustivel param
      offer({ price: 12000, url: 'b', modelo: '116', combustivel: 'gasolina' }),
    ],
  };
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000, fuelType: 'Petrol' };
  const out = await getComparisonDirect(listing, { fetchImpl: okFetch(payload) });
  assert.equal(out.sampleSize, 2); // the field-less one isn't dropped
});

test('getComparisonDirect rejects price outliers before averaging', async () => {
  const data = [
    ...[9000, 9500, 10000, 10500, 11000].map((p, i) =>
      offer({ price: p, url: `g${i}`, modelo: '116' })
    ),
    offer({ price: 69950, url: 'outlier', modelo: '116' }), // 1M Coupé-grade outlier
  ];
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000 };
  const out = await getComparisonDirect(listing, { fetchImpl: okFetch({ data }) });
  assert.equal(out.sampleSize, 5); // outlier trimmed
  assert.equal(out.avgPriceEur, 10000);
});

test('getComparisonDirect flags low confidence below 5 matched comparables', async () => {
  const payload = { data: [offer({ price: 10000, url: 'a', modelo: '116' })] };
  const listing = { brand: 'BMW', model: '116', year: 2013, mileageKm: 120000 };
  const out = await getComparisonDirect(listing, { fetchImpl: okFetch(payload) });
  assert.equal(out.lowConfidence, true);
});
