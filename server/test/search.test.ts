import { beforeAll, describe, expect, it } from "vitest";
import { runSearch } from "../src/services/searchService.js";
import { seedCostConfig } from "../src/store/costConfig.js";

const EMPTY_FILTERS = {
  brand: null,
  model: null,
  priceMinEur: null,
  priceMaxEur: null,
  yearFrom: null,
  maxMileageKm: null,
  fuelTypes: [],
  transmission: null,
} as const;

describe("runSearch (mock mode, end-to-end)", () => {
  beforeAll(() => {
    seedCostConfig(); // default placeholder transport + fees → complete totals
  });

  it("returns merged, sorted results with a healthy mock source", async () => {
    const res = await runSearch({ filters: { ...EMPTY_FILTERS } });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0]!.sourceId).toBe("mock");
    expect(res.sources[0]!.ok).toBe(true);
    expect(res.sort).toBe("savingDesc");
  });

  it("flags the spec-incomplete listing and computes complete ones", async () => {
    const res = await runSearch({ filters: { ...EMPTY_FILTERS, brand: "BMW", model: "320" } });
    const incomplete = res.results.find((c) => c.listing.sourceListingId === "de-bmw-320-incomplete");
    expect(incomplete?.landedCost.incomplete).toBe(true);
    expect(incomplete?.verdict).toBe("unknown");

    const complete = res.results.find((c) => c.listing.sourceListingId === "de-bmw-320-1");
    expect(complete?.landedCost.incomplete).toBe(false);
    expect(complete?.ptComparison.marketValueEur).toBeGreaterThan(0);
  });

  it("treats an electric car as ISV-exempt and complete", async () => {
    const res = await runSearch({ filters: { ...EMPTY_FILTERS, brand: "Tesla" } });
    const tesla = res.results[0];
    expect(tesla?.landedCost.breakdown.isv?.specialRegime).toBe("bev_exempt");
    expect(tesla?.landedCost.incomplete).toBe(false);
  });

  it("sorts highest saving first (nulls last)", async () => {
    const res = await runSearch({ filters: { ...EMPTY_FILTERS } });
    const savings = res.results.map((c) => c.savingEur).filter((s): s is number => s != null);
    const sorted = [...savings].sort((a, b) => b - a);
    expect(savings).toEqual(sorted);
  });
});
