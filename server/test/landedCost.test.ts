import { describe, expect, it } from "vitest";
import type { NormalizedListing } from "@importiq/shared";
import { computeLandedCost, type ResolvedCosts } from "../src/domain/landedCost.js";

const ASOF = new Date(Date.UTC(2026, 5, 22));

const baseListing: NormalizedListing = {
  sourceId: "mock",
  sourceListingId: "x",
  url: "https://example.com/x",
  title: "BMW 320 d",
  subtitle: null,
  brand: "BMW",
  model: "320",
  modelGroup: null,
  variant: "d",
  priceEur: 22000,
  mileageKm: 48000,
  firstRegistration: "2020-03",
  fuelType: "diesel",
  transmission: "automatic",
  engineCc: 1995,
  co2Gkm: 126,
  emissionStandard: "Euro6d-TEMP",
  powerKw: 140,
  imageUrl: null,
  location: "DE",
};

const goodCosts: ResolvedCosts = {
  transport: { label: "Open transporter", amountEur: 600 },
  transportMissing: null,
  legalisationItems: [
    { key: "fee.dua_registration", label: "DUA", amountEur: 65 },
    { key: "fee.inspection_ipo", label: "IPO", amountEur: 120 },
  ],
  legalisationUnset: [],
};

describe("computeLandedCost", () => {
  it("produces a complete total when every component resolves", () => {
    const lc = computeLandedCost(baseListing, goodCosts, ASOF);
    expect(lc.incomplete).toBe(false);
    expect(lc.missing).toHaveLength(0);
    expect(lc.breakdown.isv).not.toBeNull();
    // price + isv(≈3299) + vat(0) + transport(600) + legalisation(185)
    const expected = 22000 + lc.breakdown.isv!.totalEur + 0 + 600 + 185;
    expect(lc.totalLandedCostEur).toBeCloseTo(expected, 1);
    expect(lc.breakdown.vatApplicable).toBe(false);
  });

  it("is Incomplete (null total) when the listing lacks CO₂", () => {
    const lc = computeLandedCost({ ...baseListing, co2Gkm: null }, goodCosts, ASOF);
    expect(lc.incomplete).toBe(true);
    expect(lc.totalLandedCostEur).toBeNull();
    expect(lc.missing.some((m) => m.includes("CO₂"))).toBe(true);
  });

  it("is Incomplete when transport is not configured", () => {
    const lc = computeLandedCost(baseListing, {
      ...goodCosts,
      transport: null,
      transportMissing: "active transport method not selected",
    }, ASOF);
    expect(lc.incomplete).toBe(true);
    expect(lc.totalLandedCostEur).toBeNull();
    expect(lc.missing).toContain("active transport method not selected");
  });

  it("adds 23% VAT for a new means of transport (≤6,000 km)", () => {
    const lc = computeLandedCost(
      { ...baseListing, mileageKm: 3000, firstRegistration: "2026-04" },
      goodCosts,
      ASOF,
    );
    expect(lc.breakdown.vatApplicable).toBe(true);
    expect(lc.breakdown.vatEur).toBeCloseTo(22000 * 0.23, 1);
  });

  it("shows IUC separately and never folds it into the total", () => {
    const lc = computeLandedCost(baseListing, goodCosts, ASOF);
    // diesel → IUC pending verification (null), but the total still resolves.
    expect(lc.iuc.annualEur).toBeNull();
    expect(lc.totalLandedCostEur).not.toBeNull();
  });
});
