// Configuration data store (PLAN.md §4.6).
//
// A lightweight embedded SQLite database holding every cost value the user can
// negotiate or quote — transport methods and legalisation fees — plus the
// active-transport setting. The calculator reads these real values at run time;
// it never falls back to hardcoded estimates.

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { SEED_COST_CONFIG, SEED_ACTIVE_SETTINGS } from './config/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = process.env.IMPORTIQ_DB ?? join(DATA_DIR, 'importiq.db');

let db;

export function getDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_config (
      key         TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      category    TEXT NOT NULL,            -- 'transport' | 'legalisation' | 'other'
      amount_eur  REAL NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      notes       TEXT,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Retired: the per-listing PT comparison cache. The deals store now persists
    -- each computed comparison, so a separate bucketed cache is redundant — and
    -- its coarse brand|model|year|mileage key cross-contaminated distinct cars
    -- when the model was null (a petrol van served a diesel pickup's average).
    -- Dropped here so existing contaminated rows don't linger.
    DROP TABLE IF EXISTS pt_market_cache;

    -- mobile.de make/model reference-data tree (slow-moving). Single row.
    CREATE TABLE IF NOT EXISTS refdata_cache (
      source      TEXT PRIMARY KEY, -- e.g. 'mobilede'
      payload     TEXT NOT NULL,    -- JSON-encoded tree
      fetched_at  INTEGER NOT NULL
    );

    -- Apify scrape results, one row per (site + filter-set). Lets identical
    -- searches reuse data instead of re-paying the scraper (see apifySearch.js).
    CREATE TABLE IF NOT EXISTS listings_cache (
      cache_key   TEXT PRIMARY KEY, -- e.g. 'apify:mobilede:{…filters…}'
      payload     TEXT NOT NULL,    -- JSON-encoded raw dataset items
      fetched_at  INTEGER NOT NULL
    );

    -- Persistent, batch-filled deal store (TODO: daily-batch-deal-ingestion).
    -- One row per unique source listing, holding the fully-computed landed-cost
    -- + PT-comparison result plus extracted columns for cheap SQL filter/sort,
    -- so the UI search reads from here instead of triggering a live scrape.
    CREATE TABLE IF NOT EXISTS deals (
      deal_key         TEXT PRIMARY KEY,   -- stable identity: source + ":" + listing_id
      source           TEXT NOT NULL,      -- autoscout24 | mobilede | olxpt | standvirtual
      listing_id       TEXT NOT NULL,      -- source-native id
      url              TEXT,
      content_key      TEXT,               -- brand|model|year|price|mileage (cross-source collapse, deferred)
      -- extracted, indexed columns for filtering/sorting in the UI:
      brand            TEXT,
      model            TEXT,
      year             INTEGER,
      mileage_km       INTEGER,
      fuel_type        TEXT,
      country          TEXT,               -- DE | PT
      price_eur        INTEGER,            -- source asking price
      total_landed_eur REAL,              -- null when incomplete
      market_value_eur REAL,
      saving_eur       REAL,               -- verdict saving vs PT market (null if incomplete)
      margin_eur       REAL,
      verdict          TEXT,               -- good_deal | fair | overpriced | unknown | incomplete
      incomplete       INTEGER NOT NULL DEFAULT 0,
      -- enrichment tracking — so a failed detail-fetch is retried next run, not lost:
      enrich_status    TEXT NOT NULL DEFAULT 'enrich_pending', -- complete | enrich_pending | source_missing
      missing_fields   TEXT,               -- csv of required fields still null (audit/UI)
      enriched_at      INTEGER,            -- epoch ms of the last successful enrich attempt
      -- full payloads so the UI gets exactly the computed object:
      listing_json     TEXT NOT NULL,      -- normalised + enriched listing
      result_json      TEXT NOT NULL,      -- computeLandedCost + attachComparison output
      -- lifecycle / freshness:
      price_hash       TEXT,               -- detect price changes → recompute
      config_version   TEXT,               -- cost-config version this was computed under
      first_seen_at    INTEGER NOT NULL,   -- epoch ms — when we first ingested it
      last_seen_at     INTEGER NOT NULL,   -- epoch ms — last batch run that still saw it live
      computed_at      INTEGER NOT NULL,   -- when result_json was last (re)computed
      status           TEXT NOT NULL DEFAULT 'active'  -- active | stale | sold
    );
    CREATE INDEX IF NOT EXISTS idx_deals_verdict ON deals(status, saving_eur DESC);
    CREATE INDEX IF NOT EXISTS idx_deals_brand   ON deals(status, brand, model);
    CREATE INDEX IF NOT EXISTS idx_deals_price   ON deals(status, price_eur);
    CREATE INDEX IF NOT EXISTS idx_deals_enrich  ON deals(enrich_status);
  `);
}

// Insert seed rows only when missing — never clobber user edits.
function seed(db) {
  const insertConfig = db.prepare(`
    INSERT OR IGNORE INTO cost_config (key, label, category, amount_eur, enabled, notes, updated_at)
    VALUES (@key, @label, @category, @amount_eur, @enabled, @notes, @updated_at)
  `);
  const now = '2025-01-01T00:00:00.000Z'; // deterministic seed stamp
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insertConfig.run({ ...r, updated_at: now });
  });
  insertMany(SEED_COST_CONFIG);

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO active_settings (key, value) VALUES (@key, @value)
  `);
  const insertSettings = db.transaction((rows) => {
    for (const r of rows) insertSetting.run(r);
  });
  insertSettings(SEED_ACTIVE_SETTINGS);
}

// --- Read helpers -----------------------------------------------------------

export function getAllCostConfig() {
  return getDb()
    .prepare('SELECT * FROM cost_config ORDER BY category, key')
    .all()
    .map((r) => ({ ...r, enabled: !!r.enabled }));
}

export function getActiveSettings() {
  const rows = getDb().prepare('SELECT key, value FROM active_settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Runtime settings (data source + credentials) edited from the Settings UI live
 * under `runtime.*` keys in active_settings. Returns them as a flat object with
 * the `runtime.` prefix stripped, e.g. { data_source: 'apify', apify_token: '…' }.
 * Consumed by config.js to override env/defaults without a restart.
 */
export function getRuntimeSettings() {
  const rows = getDb()
    .prepare("SELECT key, value FROM active_settings WHERE key LIKE 'runtime.%'")
    .all();
  return Object.fromEntries(rows.map((r) => [r.key.slice('runtime.'.length), r.value]));
}

/**
 * A short, deterministic fingerprint of everything the landed-cost composer
 * reads from config — the cost rows (amount + enabled, the bits that move a
 * total) plus the active transport method. Stamped onto each stored deal so the
 * batch knows to recompute a row when the user edits ISV/transport/legalisation
 * in the Config UI, even though the listing price is unchanged.
 */
export function costConfigVersion(rows, activeTransportMethod) {
  const relevant = rows
    .map((r) => [r.key, r.amount_eur, r.enabled ? 1 : 0, r.category])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha1')
    .update(JSON.stringify({ relevant, activeTransportMethod: activeTransportMethod ?? null }))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Build the view the calculator consumes: rows keyed by `key`, plus the active
 * transport method. Cached by callers for the duration of a bot run. `version`
 * is the cost-config fingerprint used for batch recompute invalidation.
 */
export function buildConfigView() {
  const rows = getAllCostConfig();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const settings = getActiveSettings();
  const activeTransportMethod = settings['transport.active_method'] ?? null;
  return {
    rows,
    byKey,
    settings,
    activeTransportMethod,
    version: costConfigVersion(rows, activeTransportMethod),
  };
}

// --- Write helpers ----------------------------------------------------------

export function updateCostConfig(key, { amount_eur, enabled, notes }, updatedAt) {
  const existing = getDb().prepare('SELECT key FROM cost_config WHERE key = ?').get(key);
  if (!existing) return null;

  const fields = [];
  const params = { key, updated_at: updatedAt };
  if (amount_eur !== undefined) {
    fields.push('amount_eur = @amount_eur');
    params.amount_eur = amount_eur;
  }
  if (enabled !== undefined) {
    fields.push('enabled = @enabled');
    params.enabled = enabled ? 1 : 0;
  }
  if (notes !== undefined) {
    fields.push('notes = @notes');
    params.notes = notes;
  }
  fields.push('updated_at = @updated_at');

  getDb()
    .prepare(`UPDATE cost_config SET ${fields.join(', ')} WHERE key = @key`)
    .run(params);

  const row = getDb().prepare('SELECT * FROM cost_config WHERE key = ?').get(key);
  return { ...row, enabled: !!row.enabled };
}

// --- Cache helpers (PT comparisons + mobile.de refdata) ---------------------

/** Read a cached value if still within `ttlMs`, else null. `now` is epoch ms. */
export function getCached(table, key, ttlMs, now) {
  const col = table === 'refdata_cache' ? 'source' : 'cache_key';
  const row = getDb().prepare(`SELECT payload, fetched_at FROM ${table} WHERE ${col} = ?`).get(key);
  if (!row) return null;
  if (now - row.fetched_at > ttlMs) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

/** Upsert a cached JSON payload with a fetched-at stamp (epoch ms). */
export function setCached(table, key, payload, now) {
  const col = table === 'refdata_cache' ? 'source' : 'cache_key';
  getDb()
    .prepare(
      `INSERT INTO ${table} (${col}, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(${col}) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
    )
    .run(key, JSON.stringify(payload), now);
}

export function setActiveSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO active_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
  return { key, value };
}

// --- Deals store (batch deal-ingestion) -------------------------------------

// Every column we write/update. `first_seen_at` is deliberately excluded from
// the conflict update so an upsert preserves when we first ingested the car.
const DEAL_COLUMNS = [
  'deal_key', 'source', 'listing_id', 'url', 'content_key', 'brand', 'model',
  'year', 'mileage_km', 'fuel_type', 'country', 'price_eur', 'total_landed_eur',
  'market_value_eur', 'saving_eur', 'margin_eur', 'verdict', 'incomplete',
  'enrich_status', 'missing_fields', 'enriched_at', 'listing_json', 'result_json',
  'price_hash', 'config_version', 'first_seen_at', 'last_seen_at', 'computed_at',
  'status',
];

/** Read one deal by its stable key, or undefined. Payload JSON is left raw. */
export function getDeal(dealKey) {
  return getDb().prepare('SELECT * FROM deals WHERE deal_key = ?').get(dealKey);
}

/**
 * Insert or update one deal row keyed on `deal_key`. Re-seeing a known car
 * updates it in place (no duplicate); `first_seen_at` is never overwritten.
 */
export function upsertDeal(row) {
  const cols = DEAL_COLUMNS.join(', ');
  const placeholders = DEAL_COLUMNS.map((c) => `@${c}`).join(', ');
  const updates = DEAL_COLUMNS.filter((c) => c !== 'deal_key' && c !== 'first_seen_at')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  // Fill any column the caller omitted with null so the prepared statement binds.
  const params = Object.fromEntries(DEAL_COLUMNS.map((c) => [c, row[c] ?? null]));
  getDb()
    .prepare(
      `INSERT INTO deals (${cols}) VALUES (${placeholders})
       ON CONFLICT(deal_key) DO UPDATE SET ${updates}`
    )
    .run(params);
  return params;
}

/**
 * Touch freshness on a batch of still-live deals without recomputing them. Seen
 * live this run ⇒ active again, so a previously stale/sold row that reappeared
 * in the inventory is promoted back (the skip-unchanged path's counterpart to a
 * recompute resetting status='active').
 */
export function markDealsLastSeen(keys, now) {
  if (!keys?.length) return;
  const stmt = getDb().prepare(
    "UPDATE deals SET last_seen_at = ?, status = 'active' WHERE deal_key = ?"
  );
  const tx = getDb().transaction((ks) => {
    for (const k of ks) stmt.run(now, k);
  });
  tx(keys);
}

/**
 * Age out deals the batch hasn't seen recently: not seen for `staleAfterMs` →
 * 'stale'; not seen for `soldAfterMs` → 'sold' (hidden from the UI). Returns the
 * number of rows transitioned to each state.
 */
export function ageOutDeals(now, staleAfterMs, soldAfterMs) {
  const db = getDb();
  const sold = db
    .prepare(
      `UPDATE deals SET status = 'sold'
       WHERE status IN ('active', 'stale') AND last_seen_at < ?`
    )
    .run(now - soldAfterMs).changes;
  const stale = db
    .prepare(
      `UPDATE deals SET status = 'stale'
       WHERE status = 'active' AND last_seen_at < ?`
    )
    .run(now - staleAfterMs).changes;
  return { stale, sold };
}

/** Permanently drop long-sold rows so the store doesn't grow without bound. */
export function purgeOldSoldDeals(now, purgeAfterMs) {
  return getDb()
    .prepare(`DELETE FROM deals WHERE status = 'sold' AND last_seen_at < ?`)
    .run(now - purgeAfterMs).changes;
}

/**
 * The cross-run enrich retry queue: deals whose detail fetch previously failed
 * (`enrich_status='enrich_pending'`), oldest attempt first so nothing starves.
 * `listing_json` is parsed onto `.listing` for the caller. Bounded by `limit`.
 */
export function getDealsNeedingEnrichment(limit) {
  const rows = getDb()
    .prepare(
      `SELECT * FROM deals WHERE enrich_status = 'enrich_pending'
       ORDER BY (enriched_at IS NULL) DESC, enriched_at ASC, last_seen_at ASC
       LIMIT ?`
    )
    .all(limit);
  return rows.map((r) => ({ ...r, listing: JSON.parse(r.listing_json) }));
}

/** Count of rows still awaiting a successful enrich (for run logging). */
export function countDealsNeedingEnrichment() {
  return getDb()
    .prepare(`SELECT COUNT(*) n FROM deals WHERE enrich_status = 'enrich_pending'`)
    .get().n;
}

const DEAL_SORTS = {
  saving: 'saving_eur DESC',
  margin: 'margin_eur DESC',
  landed: 'total_landed_eur ASC',
  price: 'price_eur ASC',
  year: 'year DESC',
  mileage: 'mileage_km ASC',
};

const dealNorm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * One page of active deals matching `filters`, sorted server-side (so paging is
 * stable), returning the stored `result_json` objects verbatim — exactly the
 * shape the live search produced. `total`/`totalPages` count the full match.
 *
 * @param {object} filters  brand, model, yearFrom, priceMin, priceMax,
 *                          maxMileageKm, fuelTypes[]
 * @param {object} [opts]   { sort, page, pageSize }
 */
export function getDealsPage(filters = {}, opts = {}) {
  // Show active + stale (a stale row may still be a live listing the sweep just
  // hasn't re-reached); only 'sold' is hidden from the UI.
  const where = ["status IN ('active', 'stale')"];
  const params = {};
  if (filters.brand) {
    where.push('lower(brand) = @brand');
    params.brand = dealNorm(filters.brand);
  }
  if (filters.model) {
    where.push('lower(model) LIKE @model');
    params.model = `%${dealNorm(filters.model)}%`;
  }
  if (filters.yearFrom != null) {
    where.push('year >= @yearFrom');
    params.yearFrom = Number(filters.yearFrom);
  }
  if (filters.priceMin != null) {
    where.push('price_eur >= @priceMin');
    params.priceMin = Number(filters.priceMin);
  }
  if (filters.priceMax != null) {
    where.push('price_eur <= @priceMax');
    params.priceMax = Number(filters.priceMax);
  }
  if (filters.maxMileageKm != null) {
    where.push('mileage_km <= @maxMileageKm');
    params.maxMileageKm = Number(filters.maxMileageKm);
  }
  if (Array.isArray(filters.fuelTypes) && filters.fuelTypes.length) {
    const names = filters.fuelTypes.map((f, i) => {
      params[`fuel${i}`] = dealNorm(f);
      return `@fuel${i}`;
    });
    where.push(`lower(fuel_type) IN (${names.join(', ')})`);
  }

  const whereSql = where.join(' AND ');
  const orderSql = DEAL_SORTS[opts.sort] ?? DEAL_SORTS.saving;
  const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 50));
  const page = Math.max(1, Number(opts.page) || 1);

  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM deals WHERE ${whereSql}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT result_json FROM deals WHERE ${whereSql}
       ORDER BY ${orderSql} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

  return {
    results: rows.map((r) => JSON.parse(r.result_json)),
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    page,
    pageSize,
  };
}
