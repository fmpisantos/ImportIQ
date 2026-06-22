import { describe, expect, it } from "vitest";
import type { NormalizedListing } from "@importiq/shared";
import { isComparable, selectComparables, subjectSpecOf } from "../src/domain/comparison/matching.js";
import { estimatePtValue } from "../src/domain/comparison/estimate.js";
import type { PtComparable } from "../src/domain/comparison/types.js";

const subject: NormalizedListing = {
  sourceId: "mock",
  sourceListingId: "x",
  url: "u",
  title: "BMW 320 d",
  subtitle: null,
  brand: "BMW",
  model: "320",
  modelGroup: "3 Series",
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

function cmp(over: Partial<PtComparable>): PtComparable {
  return {
    sourceId: "standvirtual",
    url: "pt-u",
    title: "BMW 320 d",
    brand: "BMW",
    model: "320",
    variant: "d",
    priceEur: 31000,
    mileageKm: 50000,
    year: 2020,
    fuelType: "diesel",
    engineCc: 1995,
    powerKw: 140,
    ratingIndicator: "IN",
    ...over,
  };
}

describe("isComparable", () => {
  const spec = subjectSpecOf(subject)!;
  it("accepts a matching diesel 320", () => {
    expect(isComparable(subject, spec, cmp({}))).toBe(true);
  });
  it("rejects a different model (520)", () => {
    expect(isComparable(subject, spec, cmp({ model: "520" }))).toBe(false);
  });
  it("rejects a different fuel when both publish it", () => {
    expect(isComparable(subject, spec, cmp({ fuelType: "petrol" }))).toBe(false);
  });
  it("rejects a performance variant by displacement (+>10%)", () => {
    expect(isComparable(subject, spec, cmp({ engineCc: 2993 }))).toBe(false);
  });
  it("rejects by power (+>15%)", () => {
    expect(isComparable(subject, spec, cmp({ powerKw: 250 }))).toBe(false);
  });
  it("does NOT disqualify on a field missing on one side", () => {
    expect(isComparable(subject, spec, cmp({ engineCc: null, powerKw: null }))).toBe(true);
  });
  it("rejects out-of-window year and mileage", () => {
    expect(isComparable(subject, spec, cmp({ year: 2015 }))).toBe(false);
    expect(isComparable(subject, spec, cmp({ mileageKm: 90000 }))).toBe(false);
  });
});

describe("estimatePtValue", () => {
  it("returns Unknown below the minimum sample", () => {
    const r = estimatePtValue([cmp({}), cmp({})], 48000);
    expect(r.unknown).toBe(true);
    expect(r.marketValueEur).toBeNull();
  });

  it("produces a value + provenance with enough comparables", () => {
    const pool = selectComparables(subject, [
      cmp({ url: "a", priceEur: 30000 }),
      cmp({ url: "b", priceEur: 31000 }),
      cmp({ url: "c", priceEur: 32000, sourceId: "olxpt" }),
    ]);
    const r = estimatePtValue(pool, 48000);
    expect(r.unknown).toBe(false);
    expect(r.marketValueEur).toBeGreaterThan(0);
    expect(r.sampleSize).toBe(3);
    expect(r.method).not.toBeNull();
    expect(r.sources.map((s) => s.sourceId).sort()).toEqual(["olxpt", "standvirtual"]);
  });
});
