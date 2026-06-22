/**
 * Request validation schemas (zod). Keeping these in one place means every route
 * parses untrusted input the same way and the handlers receive typed values that
 * line up with `@importiq/shared`.
 */

import { z } from "zod";

const fuelType = z.enum(["petrol", "diesel", "electric", "hybrid", "phev", "lpg", "cng", "other"]);
const transmission = z.enum(["automatic", "manual"]);
const sortKey = z.enum(["savingDesc", "landedCostAsc", "germanPriceAsc", "yearDesc", "mileageAsc"]);
const sourceId = z.enum(["autoscout24", "mobilede", "mock"]);
const maxMileage = z.union([
  z.literal(30000),
  z.literal(50000),
  z.literal(80000),
  z.literal(100000),
  z.literal(150000),
  z.literal(200000),
]);

export const searchFiltersSchema = z.object({
  brand: z.string().trim().min(1).nullable().default(null),
  model: z.string().trim().min(1).nullable().default(null),
  priceMinEur: z.number().nonnegative().nullable().default(null),
  priceMaxEur: z.number().nonnegative().nullable().default(null),
  yearFrom: z.number().int().min(1950).max(2100).nullable().default(null),
  maxMileageKm: maxMileage.nullable().default(null),
  fuelTypes: z.array(fuelType).default([]),
  transmission: transmission.nullable().default(null),
});

export const searchRequestSchema = z.object({
  filters: searchFiltersSchema,
  pages: z.record(sourceId, z.number().int().positive()).optional(),
  sort: sortKey.optional(),
});

export const configPatchSchema = z.object({
  amountEur: z.number().nonnegative().optional(),
  enabled: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export const activeTransportSchema = z.object({ method: z.string().min(1) });

export const otherRowSchema = z.object({
  label: z.string().trim().min(1),
  amountEur: z.number().nonnegative(),
});

export const batchCreateSchema = z.object({
  name: z.string().trim().min(1),
  filters: searchFiltersSchema,
});

export const batchPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  filters: searchFiltersSchema.optional(),
  enabled: z.boolean().optional(),
});
