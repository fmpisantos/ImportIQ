/**
 * Cost-configuration store (Specification §6).
 *
 * Holds the non-derivable, user-owned costs (transport + legalisation + other)
 * and the active transport method. Seeding is idempotent (`INSERT OR IGNORE`) so
 * re-running setup never clobbers the user's edits (§6.2). Seeded amounts are
 * clearly-labelled placeholders the user is expected to replace with real quotes.
 */

import type { ConfigCategory, CostConfigRow } from "@importiq/shared";
import { db } from "./db.js";

export const ACTIVE_TRANSPORT_KEY = "transport.active_method";

interface SeedRow {
  key: string;
  label: string;
  category: ConfigCategory;
  amountEur: number;
  enabled: boolean;
  guidance: string;
}

const PLACEHOLDER_NOTE = "Placeholder — replace with your real quote.";

const SEED_ROWS: SeedRow[] = [
  // Transport (Germany → Portugal) — user picks one active method per run.
  { key: "transport.open_carrier", label: "Open transporter", category: "transport", amountEur: 600, enabled: true, guidance: "Typical market ~€500–700 (guidance only)." },
  { key: "transport.enclosed", label: "Enclosed transporter", category: "transport", amountEur: 1000, enabled: true, guidance: "Typical ~€800–1,200 (guidance only)." },
  { key: "transport.drive_down", label: "Drive it down yourself", category: "transport", amountEur: 400, enabled: true, guidance: "Fuel / tolls / time." },
  // Legalisation & registration — summed when enabled.
  { key: "fee.dua_registration", label: "DUA / registration (IMT)", category: "legalisation", amountEur: 65, enabled: true, guidance: "Official IMT tariff (approx.)." },
  { key: "fee.inspection_ipo", label: "Inspection (IPO)", category: "legalisation", amountEur: 120, enabled: true, guidance: "IPO centre price." },
  { key: "fee.dav_customs", label: "Customs declaration (DAV)", category: "legalisation", amountEur: 50, enabled: true, guidance: "If applicable." },
  { key: "fee.agent_dispatcher", label: "Dispatcher / agent", category: "legalisation", amountEur: 250, enabled: false, guidance: "Optional." },
];

const insertSeed = db.prepare(
  `INSERT OR IGNORE INTO cost_config (key, label, category, amount_eur, enabled, notes, guidance, updated_at)
   VALUES (@key, @label, @category, @amountEur, @enabled, @notes, @guidance, @updatedAt)`,
);
const insertActive = db.prepare(
  "INSERT OR IGNORE INTO active_settings (key, value) VALUES (?, ?)",
);

/** Idempotently seed the default rows + a default active transport method. */
export function seedCostConfig(now: string = new Date().toISOString()): void {
  const tx = db.transaction(() => {
    for (const r of SEED_ROWS) {
      insertSeed.run({
        key: r.key,
        label: r.label,
        category: r.category,
        amountEur: r.amountEur,
        enabled: r.enabled ? 1 : 0,
        notes: PLACEHOLDER_NOTE,
        guidance: r.guidance,
        updatedAt: now,
      });
    }
    insertActive.run(ACTIVE_TRANSPORT_KEY, "transport.open_carrier");
  });
  tx();
}

// --- Row mapping -----------------------------------------------------------

interface DbRow {
  key: string;
  label: string;
  category: string;
  amount_eur: number;
  enabled: number;
  notes: string | null;
  guidance: string | null;
  updated_at: string;
}

function toRow(r: DbRow): CostConfigRow {
  return {
    key: r.key,
    label: r.label,
    category: r.category as ConfigCategory,
    amountEur: r.amount_eur,
    enabled: r.enabled === 1,
    notes: r.notes,
    guidance: r.guidance,
    updatedAt: r.updated_at,
  };
}

// --- Reads -----------------------------------------------------------------

const selectAll = db.prepare("SELECT * FROM cost_config ORDER BY category, key");
const selectActive = db.prepare("SELECT value FROM active_settings WHERE key = ?");

export function listConfig(): CostConfigRow[] {
  return (selectAll.all() as DbRow[]).map(toRow);
}

export function getActiveTransportMethod(): string | null {
  const row = selectActive.get(ACTIVE_TRANSPORT_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

// --- Writes ----------------------------------------------------------------

const updateRowStmt = db.prepare(
  `UPDATE cost_config
   SET amount_eur = @amountEur, enabled = @enabled, notes = @notes, updated_at = @updatedAt
   WHERE key = @key`,
);
const setActiveStmt = db.prepare(
  "INSERT INTO active_settings (key, value) VALUES (?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
);
const insertOther = db.prepare(
  `INSERT INTO cost_config (key, label, category, amount_eur, enabled, notes, guidance, updated_at)
   VALUES (@key, @label, 'other', @amountEur, 1, NULL, NULL, @updatedAt)
   ON CONFLICT(key) DO UPDATE SET label = excluded.label, amount_eur = excluded.amount_eur, updated_at = excluded.updated_at`,
);
const selectOne = db.prepare("SELECT * FROM cost_config WHERE key = ?");
const deleteStmt = db.prepare("DELETE FROM cost_config WHERE key = ?");

export interface RowPatch {
  amountEur?: number;
  enabled?: boolean;
  notes?: string | null;
}

/** Update an existing row's amount / enabled / notes. Returns the new row. */
export function updateConfigRow(key: string, patch: RowPatch): CostConfigRow | null {
  const existing = selectOne.get(key) as DbRow | undefined;
  if (!existing) return null;
  updateRowStmt.run({
    key,
    amountEur: patch.amountEur ?? existing.amount_eur,
    enabled: (patch.enabled ?? existing.enabled === 1) ? 1 : 0,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    updatedAt: new Date().toISOString(),
  });
  return toRow(selectOne.get(key) as DbRow);
}

export function setActiveTransport(method: string): void {
  setActiveStmt.run(ACTIVE_TRANSPORT_KEY, method);
}

/** Add (or upsert) a free-form "other" cost row (§6.1). */
export function addOtherRow(label: string, amountEur: number): CostConfigRow {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const key = `other.${slug || "item"}`;
  insertOther.run({ key, label: label.trim(), amountEur, updatedAt: new Date().toISOString() });
  return toRow(selectOne.get(key) as DbRow);
}

export function deleteConfigRow(key: string): boolean {
  return deleteStmt.run(key).changes > 0;
}
