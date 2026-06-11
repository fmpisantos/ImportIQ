import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, getComparisonDirect, brandCategoryId } from '../src/adapters/direct/olxpt.js';

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
  assert.ok(out.searchUrl.startsWith('https://www.olx.pt/carros-motos-e-barcos/carros/q-320i/'));
});

test('brandCategoryId resolves aliases and falls back to the cars root', () => {
  assert.equal(brandCategoryId('Volkswagen'), 777);
  assert.equal(brandCategoryId('Citroën'), 727);
  assert.equal(brandCategoryId('NotABrand'), 378);
});
