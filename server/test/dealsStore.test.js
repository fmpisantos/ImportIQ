// Tests for the `deals` store helpers in db.js (batch deal-ingestion): keyed
// upsert/dedupe, page filter/sort/paginate, freshness lifecycle (age-out +
// purge), the enrich-retry queue, and the cost-config version fingerprint.
// Runs against a throwaway SQLite file — no network.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.IMPORTIQ_DB = join(mkdtempSync(join(tmpdir(), 'importiq-deals-')), 'test.db');

const {
  getDb,
  upsertDeal,
  getDeal,
  getDealsPage,
  markDealsLastSeen,
  ageOutDeals,
  purgeOldSoldDeals,
  getDealsNeedingEnrichment,
  countDealsNeedingEnrichment,
  costConfigVersion,
} = await import('../src/db.js');

// Build a full deal row; overrides win. NOT-NULL columns are always populated.
function row(o = {}) {
  const id = String(o.listing_id ?? '1');
  const source = o.source ?? 'autoscout24';
  return {
    deal_key: o.deal_key ?? `${source}:${id}`,
    source,
    listing_id: id,
    brand: o.brand ?? 'BMW',
    model: o.model ?? '320d',
    year: o.year ?? 2019,
    // Presence-checked, not `??`: these columns are nullable and some tests need
    // an explicit null (a car whose odometer or price the source never published).
    mileage_km: 'mileage_km' in o ? o.mileage_km : 90000,
    fuel_type: o.fuel_type ?? 'Diesel',
    price_eur: 'price_eur' in o ? o.price_eur : 20000,
    total_landed_eur: o.total_landed_eur ?? null,
    saving_eur: o.saving_eur ?? null,
    margin_eur: o.margin_eur ?? null,
    verdict: o.verdict ?? 'unknown',
    incomplete: o.incomplete ?? 0,
    enrich_status: o.enrich_status ?? 'complete',
    enriched_at: o.enriched_at ?? null,
    listing_json: JSON.stringify(o.listing ?? { id }),
    result_json: JSON.stringify(o.result ?? { listing: { id }, savingEur: o.saving_eur ?? null }),
    price_hash: o.price_hash ?? String(o.price_eur ?? 20000),
    config_version: o.config_version ?? 'v1',
    first_seen_at: o.first_seen_at ?? 1000,
    last_seen_at: o.last_seen_at ?? 1000,
    computed_at: o.computed_at ?? 1000,
    status: o.status ?? 'active',
  };
}

before(() => getDb());
beforeEach(() => getDb().prepare('DELETE FROM deals').run());

test('upsert inserts, and re-upserting the same key updates in place (no duplicate)', () => {
  upsertDeal(row({ listing_id: '1', price_eur: 20000, first_seen_at: 1000, last_seen_at: 1000 }));
  upsertDeal(row({ listing_id: '1', price_eur: 18000, first_seen_at: 5000, last_seen_at: 9000 }));

  const all = getDb().prepare('SELECT * FROM deals').all();
  assert.equal(all.length, 1, 'same deal_key must not duplicate');
  const d = getDeal('autoscout24:1');
  assert.equal(d.price_eur, 18000);
  assert.equal(d.last_seen_at, 9000);
  // first_seen_at is preserved across upserts.
  assert.equal(d.first_seen_at, 1000);
});

test('getDealsPage filters, sorts saving DESC (nulls last), and paginates', () => {
  upsertDeal(row({ listing_id: 'a', brand: 'BMW', saving_eur: 100, price_eur: 20000 }));
  upsertDeal(row({ listing_id: 'b', brand: 'BMW', saving_eur: null, price_eur: 15000 }));
  upsertDeal(row({ listing_id: 'c', brand: 'BMW', saving_eur: 50, price_eur: 30000 }));
  upsertDeal(row({ listing_id: 'd', brand: 'Audi', saving_eur: 999, price_eur: 10000 }));

  const bmw = getDealsPage({ brand: 'BMW' }, { sort: 'saving', page: 1, pageSize: 10 });
  assert.equal(bmw.total, 3, 'Audi excluded by the brand filter');
  // 100, 50, then the null saving last.
  assert.deepEqual(bmw.results.map((r) => r.savingEur), [100, 50, null]);

  // price filter + price sort. b is cheaper but has no PT benchmark, so it
  // ranks below a (see the un-benchmarked tier test below).
  const cheap = getDealsPage({ brand: 'BMW', priceMax: 20000 }, { sort: 'price' });
  assert.equal(cheap.total, 2); // a(20000) and b(15000)
  assert.deepEqual(cheap.results.map((r) => r.listing.id), ['a', 'b']);

  // pagination
  const p1 = getDealsPage({ brand: 'BMW' }, { sort: 'saving', page: 1, pageSize: 2 });
  assert.equal(p1.total, 3);
  assert.equal(p1.totalPages, 2);
  assert.equal(p1.results.length, 2);
});

test('the brand filter matches across spellings of the same marque', () => {
  // AS24 stores "Skoda"; the filter dropdown offers the catalog's "Škoda".
  upsertDeal(row({ listing_id: 'sk', brand: 'Skoda', model: 'Octavia' }));
  upsertDeal(row({ listing_id: 'mb', brand: 'Mercedes Benz', model: 'C 220 d' }));

  assert.equal(getDealsPage({ brand: 'Škoda' }).total, 1);
  assert.equal(getDealsPage({ brand: 'Skoda' }).total, 1);
  assert.equal(getDealsPage({ brand: 'Mercedes-Benz' }).total, 1);
  assert.equal(getDealsPage({ brand: 'Porsche' }).total, 0);
});

test('getDealsPage sinks deals with no PT benchmark under every sort key', () => {
  // No PT comparables → saving_eur null. It's the cheapest, newest, lowest-mileage
  // and cheapest-landed of the three, so a naive sort would put it first every time.
  upsertDeal(
    row({
      listing_id: 'noPt', saving_eur: null, price_eur: 5000, year: 2023,
      mileage_km: 10000, total_landed_eur: 7000,
    })
  );
  upsertDeal(
    row({
      listing_id: 'lo', saving_eur: 100, price_eur: 20000, year: 2018,
      mileage_km: 120000, total_landed_eur: 25000, margin_eur: 100,
    })
  );
  upsertDeal(
    row({
      listing_id: 'hi', saving_eur: 900, price_eur: 30000, year: 2019,
      mileage_km: 90000, total_landed_eur: 35000, margin_eur: 900,
    })
  );

  const order = (sort) => getDealsPage({}, { sort }).results.map((r) => r.listing.id);
  assert.deepEqual(order('saving'), ['hi', 'lo', 'noPt']);
  assert.deepEqual(order('margin'), ['hi', 'lo', 'noPt']);
  assert.deepEqual(order('landed'), ['lo', 'hi', 'noPt']);
  assert.deepEqual(order('price'), ['lo', 'hi', 'noPt']);
  assert.deepEqual(order('year'), ['hi', 'lo', 'noPt']);
  assert.deepEqual(order('mileage'), ['hi', 'lo', 'noPt']);
});

test('getDealsPage ranks an uncostable deal below a costable one that also lacks a benchmark', () => {
  upsertDeal(row({ listing_id: 'incomplete', saving_eur: null, total_landed_eur: null, incomplete: 1 }));
  upsertDeal(row({ listing_id: 'noPt', saving_eur: null, total_landed_eur: 9000 }));
  upsertDeal(row({ listing_id: 'ok', saving_eur: 500, total_landed_eur: 25000 }));

  // 'landed ASC' used to open with the NULL-landed row (SQLite orders NULL first).
  assert.deepEqual(
    getDealsPage({}, { sort: 'landed' }).results.map((r) => r.listing.id),
    ['ok', 'noPt', 'incomplete']
  );
});

test('getDealsPage sinks unknown mileage/price to the end of an ascending sort', () => {
  // A car can be costed AND benchmarked with no odometer — completeness needs
  // CO₂ + displacement, not mileage. SQLite orders NULL first on ASC, so without
  // an explicit guard the unknown-mileage car opened "lowest mileage first".
  upsertDeal(row({ listing_id: 'unknownKm', mileage_km: null, saving_eur: 100 }));
  upsertDeal(row({ listing_id: 'lowKm', mileage_km: 10000, saving_eur: 100 }));
  upsertDeal(row({ listing_id: 'highKm', mileage_km: 200000, saving_eur: 100 }));

  assert.deepEqual(
    getDealsPage({}, { sort: 'mileage' }).results.map((r) => r.listing.id),
    ['lowKm', 'highKm', 'unknownKm']
  );

  upsertDeal(row({ listing_id: 'noPrice', price_eur: null, saving_eur: 100, mileage_km: 90000 }));
  const byPrice = getDealsPage({}, { sort: 'price' }).results.map((r) => r.listing.id);
  assert.equal(byPrice.at(-1), 'noPrice', 'a deal with no asking price ranks last, not first');
});

test('getDealsPage filters on both mileage bounds', () => {
  upsertDeal(row({ listing_id: 'low', mileage_km: 20000, saving_eur: 100 }));
  upsertDeal(row({ listing_id: 'mid', mileage_km: 90000, saving_eur: 100 }));
  upsertDeal(row({ listing_id: 'high', mileage_km: 180000, saving_eur: 100 }));

  const ids = (f) => getDealsPage(f, { sort: 'mileage' }).results.map((r) => r.listing.id);
  assert.deepEqual(ids({ minMileageKm: 50000 }), ['mid', 'high']);
  assert.deepEqual(ids({ maxMileageKm: 100000 }), ['low', 'mid']);
  assert.deepEqual(ids({ minMileageKm: 50000, maxMileageKm: 100000 }), ['mid']);
});

test('getDealsPage filters by fuel type case-insensitively and hides non-active', () => {
  upsertDeal(row({ listing_id: 'a', fuel_type: 'Diesel' }));
  upsertDeal(row({ listing_id: 'b', fuel_type: 'Petrol' }));
  upsertDeal(row({ listing_id: 'c', fuel_type: 'Diesel', status: 'sold' }));

  const diesel = getDealsPage({ fuelTypes: ['diesel'] }, {});
  assert.equal(diesel.total, 1, 'only the active diesel, not the sold one');
  assert.equal(diesel.results[0].listing.id, 'a');
});

test('markDealsLastSeen bumps only the given keys', () => {
  upsertDeal(row({ listing_id: 'a', last_seen_at: 1000 }));
  upsertDeal(row({ listing_id: 'b', last_seen_at: 1000 }));
  markDealsLastSeen(['autoscout24:a'], 7777);
  assert.equal(getDeal('autoscout24:a').last_seen_at, 7777);
  assert.equal(getDeal('autoscout24:b').last_seen_at, 1000);
});

test('ageOutDeals transitions active → stale → sold by freshness', () => {
  const now = 1_000_000;
  const day = 24 * 60 * 60 * 1000;
  upsertDeal(row({ listing_id: 'fresh', last_seen_at: now }));
  upsertDeal(row({ listing_id: 'old', last_seen_at: now - 4 * day }));
  upsertDeal(row({ listing_id: 'ancient', last_seen_at: now - 10 * day }));

  const { stale, sold } = ageOutDeals(now, 3 * day, 7 * day);
  assert.equal(sold, 1);
  assert.equal(stale, 1);
  assert.equal(getDeal('autoscout24:fresh').status, 'active');
  assert.equal(getDeal('autoscout24:old').status, 'stale');
  assert.equal(getDeal('autoscout24:ancient').status, 'sold');
  // Only active rows show in the UI — stale and sold are both hidden.
  assert.equal(getDealsPage({}, {}).total, 1);
});

test('purgeOldSoldDeals deletes long-sold rows only', () => {
  const now = 1_000_000;
  const day = 24 * 60 * 60 * 1000;
  upsertDeal(row({ listing_id: 'recentSold', status: 'sold', last_seen_at: now - 10 * day }));
  upsertDeal(row({ listing_id: 'oldSold', status: 'sold', last_seen_at: now - 100 * day }));
  upsertDeal(row({ listing_id: 'active', status: 'active', last_seen_at: now - 100 * day }));

  const purged = purgeOldSoldDeals(now, 90 * day);
  assert.equal(purged, 1);
  assert.equal(getDeal('autoscout24:oldSold'), undefined);
  assert.ok(getDeal('autoscout24:recentSold'));
  assert.ok(getDeal('autoscout24:active'), 'an active row is never purged');
});

test('getDealsNeedingEnrichment returns only enrich_pending, oldest first, bounded', () => {
  upsertDeal(row({ listing_id: 'done', enrich_status: 'complete' }));
  upsertDeal(row({ listing_id: 'terminal', enrich_status: 'source_missing' }));
  upsertDeal(row({ listing_id: 'p1', enrich_status: 'enrich_pending', enriched_at: 5000 }));
  upsertDeal(row({ listing_id: 'p2', enrich_status: 'enrich_pending', enriched_at: 2000 }));
  upsertDeal(row({ listing_id: 'p3', enrich_status: 'enrich_pending', enriched_at: null }));

  assert.equal(countDealsNeedingEnrichment(), 3);
  const got = getDealsNeedingEnrichment(10);
  assert.deepEqual(
    got.map((d) => d.listing_id),
    ['p3', 'p2', 'p1'],
    'never-attempted (null) first, then oldest attempt first'
  );
  // listing_json is parsed onto .listing for the caller.
  assert.ok(got[0].listing);
  // bounded by the limit
  assert.equal(getDealsNeedingEnrichment(2).length, 2);
});

test('costConfigVersion changes when an amount, enabled flag, or active method changes', () => {
  const rows = [
    { key: 'transport.open_carrier', amount_eur: 600, enabled: true, category: 'transport' },
    { key: 'fee.dua', amount_eur: 65, enabled: true, category: 'legalisation' },
  ];
  const base = costConfigVersion(rows, 'transport.open_carrier');

  // Stable for the same inputs (and order-independent).
  assert.equal(costConfigVersion([...rows].reverse(), 'transport.open_carrier'), base);

  // Amount change → different version.
  const amount = costConfigVersion(
    [{ ...rows[0], amount_eur: 700 }, rows[1]],
    'transport.open_carrier'
  );
  assert.notEqual(amount, base);

  // Enabled flip → different version.
  const disabled = costConfigVersion(
    [{ ...rows[0], enabled: false }, rows[1]],
    'transport.open_carrier'
  );
  assert.notEqual(disabled, base);

  // Active transport method change → different version.
  assert.notEqual(costConfigVersion(rows, 'transport.enclosed'), base);
});
