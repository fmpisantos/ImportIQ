// Configuration data store (PLAN.md §4.6).
//
// A lightweight embedded SQLite database holding every cost value the user can
// negotiate or quote — transport methods and legalisation fees — plus the
// active-transport setting. The calculator reads these real values at run time;
// it never falls back to hardcoded estimates.

import Database from 'better-sqlite3';
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

    -- Daily-refreshed PT market comparisons (PLAN.md §9). One row per
    -- brand/model/year/mileage bucket; JSON payload is the comparison object.
    CREATE TABLE IF NOT EXISTS pt_market_cache (
      cache_key   TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,   -- JSON-encoded comparison
      fetched_at  INTEGER NOT NULL -- epoch ms
    );

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
 * Build the view the calculator consumes: rows keyed by `key`, plus the active
 * transport method. Cached by callers for the duration of a bot run.
 */
export function buildConfigView() {
  const rows = getAllCostConfig();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const settings = getActiveSettings();
  return {
    rows,
    byKey,
    settings,
    activeTransportMethod: settings['transport.active_method'] ?? null,
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
