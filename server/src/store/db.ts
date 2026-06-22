/**
 * SQLite store bootstrap (Specification §6.2, §8).
 *
 * Opens (creating if needed) the embedded database and applies the schema. The
 * schema is idempotent (`CREATE TABLE IF NOT EXISTS`) so startup never clobbers
 * existing user data. A single shared connection is exported.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db: Database.Database = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- Cost configuration (§6.2)
  CREATE TABLE IF NOT EXISTS cost_config (
    key        TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    category   TEXT NOT NULL,              -- 'transport' | 'legalisation' | 'other'
    amount_eur REAL NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1, -- 0 = excluded from total
    notes      TEXT,
    guidance   TEXT,                       -- display-only market guidance
    updated_at TEXT NOT NULL               -- ISO timestamp
  );

  CREATE TABLE IF NOT EXISTS active_settings (
    key   TEXT PRIMARY KEY,                -- e.g. 'transport.active_method'
    value TEXT NOT NULL
  );

  -- Generic TTL cache for search results, PT comparisons, detail enrichment (§8)
  CREATE TABLE IF NOT EXISTS cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,              -- JSON payload
    expires_at INTEGER NOT NULL            -- epoch ms
  );

  -- Saved batch searches (§9)
  CREATE TABLE IF NOT EXISTS batch_search (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    filters    TEXT NOT NULL,              -- JSON SearchFilters
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Curated nightly top deals per batch (§9)
  CREATE TABLE IF NOT EXISTS batch_result (
    batch_id     TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    top_deals    TEXT NOT NULL             -- JSON ResultCard[]
  );
`);
