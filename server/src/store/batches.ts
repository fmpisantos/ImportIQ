/**
 * Batch-search store (Specification §9): saved named searches and the curated
 * nightly top-deal results.
 */

import { randomUUID } from "node:crypto";
import type { BatchResult, BatchSearch, ResultCard, SearchFilters } from "@importiq/shared";
import { db } from "./db.js";

interface DbBatch {
  id: string;
  name: string;
  filters: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function toBatch(r: DbBatch): BatchSearch {
  return {
    id: r.id,
    name: r.name,
    filters: JSON.parse(r.filters) as SearchFilters,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const selectAll = db.prepare("SELECT * FROM batch_search ORDER BY created_at");
const selectOne = db.prepare("SELECT * FROM batch_search WHERE id = ?");
const insertStmt = db.prepare(
  `INSERT INTO batch_search (id, name, filters, enabled, created_at, updated_at)
   VALUES (@id, @name, @filters, @enabled, @createdAt, @updatedAt)`,
);
const updateStmt = db.prepare(
  `UPDATE batch_search SET name = @name, filters = @filters, enabled = @enabled, updated_at = @updatedAt
   WHERE id = @id`,
);
const deleteStmt = db.prepare("DELETE FROM batch_search WHERE id = ?");

export function listBatches(): BatchSearch[] {
  return (selectAll.all() as DbBatch[]).map(toBatch);
}

export function getBatch(id: string): BatchSearch | null {
  const r = selectOne.get(id) as DbBatch | undefined;
  return r ? toBatch(r) : null;
}

export function createBatch(name: string, filters: SearchFilters): BatchSearch {
  const now = new Date().toISOString();
  const id = randomUUID();
  insertStmt.run({ id, name, filters: JSON.stringify(filters), enabled: 1, createdAt: now, updatedAt: now });
  return getBatch(id)!;
}

export interface BatchPatch {
  name?: string;
  filters?: SearchFilters;
  enabled?: boolean;
}

export function updateBatch(id: string, patch: BatchPatch): BatchSearch | null {
  const existing = getBatch(id);
  if (!existing) return null;
  updateStmt.run({
    id,
    name: patch.name ?? existing.name,
    filters: JSON.stringify(patch.filters ?? existing.filters),
    enabled: (patch.enabled ?? existing.enabled) ? 1 : 0,
    updatedAt: new Date().toISOString(),
  });
  return getBatch(id);
}

export function deleteBatch(id: string): boolean {
  return deleteStmt.run(id).changes > 0;
}

// --- Nightly results -------------------------------------------------------

const upsertResult = db.prepare(
  `INSERT INTO batch_result (batch_id, generated_at, top_deals) VALUES (@batchId, @generatedAt, @topDeals)
   ON CONFLICT(batch_id) DO UPDATE SET generated_at = excluded.generated_at, top_deals = excluded.top_deals`,
);
const selectResult = db.prepare("SELECT * FROM batch_result WHERE batch_id = ?");

interface DbResult {
  batch_id: string;
  generated_at: string;
  top_deals: string;
}

export function saveBatchResult(batchId: string, topDeals: ResultCard[]): void {
  upsertResult.run({
    batchId,
    generatedAt: new Date().toISOString(),
    topDeals: JSON.stringify(topDeals),
  });
}

export function listBatchResults(): BatchResult[] {
  const batches = listBatches();
  const out: BatchResult[] = [];
  for (const b of batches) {
    const r = selectResult.get(b.id) as DbResult | undefined;
    if (r) {
      out.push({
        batchId: b.id,
        batchName: b.name,
        generatedAt: r.generated_at,
        topDeals: JSON.parse(r.top_deals) as ResultCard[],
      });
    }
  }
  return out;
}
