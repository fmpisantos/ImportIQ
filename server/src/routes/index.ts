/**
 * API router (Specification §11). Mounts every endpoint under `/api`.
 */

import { Router } from "express";
import type { HealthResponse } from "@importiq/shared";
import { config } from "../config.js";
import { ISV_TABLES_VERSION, ISV_UNVERIFIED } from "../domain/isv/isvTables.js";
import { getBrands } from "../services/brandsService.js";
import { runSearch } from "../services/searchService.js";
import {
  addOtherRow,
  deleteConfigRow,
  setActiveTransport,
  updateConfigRow,
} from "../store/costConfig.js";
import { getConfigResponse, invalidateConfigCache } from "../services/configService.js";
import {
  createBatch,
  deleteBatch,
  listBatchResults,
  listBatches,
  updateBatch,
} from "../store/batches.js";
import { runBatch } from "../services/batchService.js";
import {
  activeTransportSchema,
  batchCreateSchema,
  batchPatchSchema,
  configPatchSchema,
  otherRowSchema,
  searchRequestSchema,
} from "./validation.js";
import { asyncHandler } from "./util.js";

export const api = Router();

// --- Health ----------------------------------------------------------------
api.get("/health", (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    sourceMode: config.sourceMode,
    isvTablesVersion: ISV_TABLES_VERSION,
    isvVerified: !ISV_UNVERIFIED,
  };
  res.json(body);
});

// --- Brands ----------------------------------------------------------------
api.get("/brands", (_req, res) => res.json(getBrands()));

// --- Search ----------------------------------------------------------------
api.post(
  "/search",
  asyncHandler(async (req, res) => {
    const parsed = searchRequestSchema.parse(req.body);
    res.json(await runSearch(parsed));
  }),
);

// --- Config ----------------------------------------------------------------
api.get("/config", (_req, res) => res.json(getConfigResponse()));

api.put("/config/:key", (req, res) => {
  const patch = configPatchSchema.parse(req.body);
  const row = updateConfigRow(req.params.key!, patch);
  if (!row) {
    res.status(404).json({ error: `Unknown config key: ${req.params.key!}` });
    return;
  }
  invalidateConfigCache();
  res.json(getConfigResponse());
});

api.post("/config/active", (req, res) => {
  const { method } = activeTransportSchema.parse(req.body);
  setActiveTransport(method);
  invalidateConfigCache();
  res.json(getConfigResponse());
});

api.post("/config/other", (req, res) => {
  const { label, amountEur } = otherRowSchema.parse(req.body);
  addOtherRow(label, amountEur);
  invalidateConfigCache();
  res.json(getConfigResponse());
});

api.delete("/config/:key", (req, res) => {
  const ok = deleteConfigRow(req.params.key!);
  if (!ok) {
    res.status(404).json({ error: `Unknown config key: ${req.params.key!}` });
    return;
  }
  invalidateConfigCache();
  res.json(getConfigResponse());
});

// --- Batches ---------------------------------------------------------------
// Specific routes before the `:id` routes.
api.get("/batches/results", (_req, res) => res.json(listBatchResults()));

api.post(
  "/batches/:id/run",
  asyncHandler(async (req, res) => {
    const batch = listBatches().find((b) => b.id === req.params.id!);
    if (!batch) {
      res.status(404).json({ error: "Unknown batch" });
      return;
    }
    const topDeals = await runBatch(batch.id, batch.name, batch.filters);
    res.json({ batchId: batch.id, batchName: batch.name, generatedAt: new Date().toISOString(), topDeals });
  }),
);

api.get("/batches", (_req, res) => res.json(listBatches()));

api.post("/batches", (req, res) => {
  const { name, filters } = batchCreateSchema.parse(req.body);
  res.status(201).json(createBatch(name, filters));
});

api.put("/batches/:id", (req, res) => {
  const patch = batchPatchSchema.parse(req.body);
  const batch = updateBatch(req.params.id!, patch);
  if (!batch) {
    res.status(404).json({ error: "Unknown batch" });
    return;
  }
  res.json(batch);
});

api.delete("/batches/:id", (req, res) => {
  const ok = deleteBatch(req.params.id!);
  if (!ok) {
    res.status(404).json({ error: "Unknown batch" });
    return;
  }
  res.json({ ok: true });
});
