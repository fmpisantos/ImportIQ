import { describe, expect, it } from "vitest";
import { ageYears, computeIsv, resolveCycle } from "../src/domain/isv/isvEngine.js";

const ASOF = new Date(Date.UTC(2026, 5, 22)); // 2026-06-22

describe("ageYears", () => {
  it("floors whole years and never goes negative", () => {
    expect(ageYears("2020-03", ASOF)).toBe(6);
    expect(ageYears("2026-06", ASOF)).toBe(0);
    expect(ageYears("2030-01", ASOF)).toBe(0);
  });
});

describe("resolveCycle", () => {
  it("prefers Euro6d+ → WLTP, else year-based", () => {
    expect(resolveCycle("2017-01", "Euro6d-TEMP")).toBe("WLTP");
    expect(resolveCycle("2020-01", null)).toBe("WLTP");
    expect(resolveCycle("2017-01", null)).toBe("NEDC");
  });
});

describe("computeIsv", () => {
  it("exempts battery-electric vehicles even without specs", () => {
    const r = computeIsv({
      engineCc: null,
      co2Gkm: null,
      fuelType: "electric",
      firstRegistration: "2021-05",
      emissionStandard: null,
      asOf: ASOF,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.breakdown.totalEur).toBe(0);
      expect(r.breakdown.specialRegime).toBe("bev_exempt");
      expect(r.breakdown.unverified).toBe(true);
    }
  });

  it("computes a diesel 320d breakdown (OE2026 draft tables)", () => {
    const r = computeIsv({
      engineCc: 1995,
      co2Gkm: 126,
      fuelType: "diesel",
      firstRegistration: "2020-03",
      emissionStandard: "Euro6d-TEMP",
      asOf: ASOF,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const b = r.breakdown;
      expect(b.cylinderComponentEur).toBeCloseTo(4997.07, 1);
      expect(b.environmentalComponentEur).toBeCloseTo(834.19, 1);
      expect(b.ageReductionFraction).toBe(0.52);
      expect(b.particulateSurchargeEur).toBe(500);
      // (4997.07 + 834.19) * 0.48 + 500 ≈ 3299.0
      expect(b.totalEur).toBeCloseTo(3299.0, 0);
      expect(b.cycle).toBe("WLTP");
    }
  });

  it("flags Incomplete when CO₂/displacement are missing", () => {
    const r = computeIsv({
      engineCc: null,
      co2Gkm: null,
      fuelType: "diesel",
      firstRegistration: "2020-03",
      emissionStandard: null,
      asOf: ASOF,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toContain("engine displacement (cm³)");
      expect(r.missing).toContain("CO₂ emissions (g/km)");
    }
  });

  it("reports Incomplete (not a guess) when the NEDC table is required", () => {
    const r = computeIsv({
      engineCc: 1600,
      co2Gkm: 120,
      fuelType: "petrol",
      firstRegistration: "2016-01", // pre-2019 → NEDC, which is not encoded
      emissionStandard: null,
      asOf: ASOF,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toMatch(/NEDC/);
  });
});
