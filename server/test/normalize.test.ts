import { describe, expect, it } from "vitest";
import {
  normalizeFuel,
  normalizeModelKey,
  normalizeTransmission,
  parseFirstRegistration,
  parseInteger,
  parseNumber,
  powerToKw,
  yearOf,
} from "../src/domain/normalize.js";

describe("parseNumber", () => {
  it("parses localized German format (thousands dot)", () => {
    expect(parseNumber("18.500 €")).toBe(18500);
    expect(parseNumber("1.995 cm³")).toBe(1995);
    expect(parseNumber("73.826 km")).toBe(73826);
  });
  it("parses English format (thousands comma)", () => {
    expect(parseNumber("€ 24,995")).toBe(24995);
    expect(parseNumber("44,583 km")).toBe(44583);
  });
  it("parses decimals correctly by separator position", () => {
    expect(parseNumber("24.999,50")).toBe(24999.5);
    expect(parseNumber("24,999.50")).toBe(24999.5);
    expect(parseNumber("190,5")).toBe(190.5);
  });
  it("returns null for unparseable input", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
});

describe("parseInteger", () => {
  it("rounds to an integer", () => {
    expect(parseInteger("1,995 cc")).toBe(1995);
    expect(parseInteger("126 g/km (comb.)")).toBe(126);
  });
});

describe("parseFirstRegistration", () => {
  it("normalises MM/YYYY and MM-YYYY", () => {
    expect(parseFirstRegistration("03/2019")).toBe("2019-03");
    expect(parseFirstRegistration("03-2018")).toBe("2018-03");
  });
  it("normalises YYYY-MM and year-only", () => {
    expect(parseFirstRegistration("2019-03")).toBe("2019-03");
    expect(parseFirstRegistration("2020")).toBe("2020-01");
  });
  it("returns null for junk", () => {
    expect(parseFirstRegistration("soon")).toBeNull();
  });
  it("yearOf extracts the year", () => {
    expect(yearOf("2019-03")).toBe(2019);
    expect(yearOf(null)).toBeNull();
  });
});

describe("normalizeFuel", () => {
  it("maps multilingual labels", () => {
    expect(normalizeFuel("Gasoline")).toBe("petrol");
    expect(normalizeFuel("gaz")).toBe("petrol"); // Standvirtual petrol value
    expect(normalizeFuel("Diesel")).toBe("diesel");
    expect(normalizeFuel("Elektro")).toBe("electric");
    expect(normalizeFuel("Plug-in-Hybrid")).toBe("phev");
    expect(normalizeFuel("Híbrido")).toBe("hybrid");
  });
});

describe("normalizeTransmission", () => {
  it("maps labels and folds semi-auto into automatic", () => {
    expect(normalizeTransmission("Automatik")).toBe("automatic");
    expect(normalizeTransmission("Automática")).toBe("automatic");
    expect(normalizeTransmission("Manual")).toBe("manual");
    expect(normalizeTransmission("Semiautomatic")).toBe("automatic");
  });
});

describe("powerToKw", () => {
  it("keeps kW and converts cv/PS", () => {
    expect(powerToKw(140, "kw")).toBe(140);
    expect(powerToKw(190, "cv")).toBe(140); // 190 cv ≈ 140 kW
    expect(powerToKw(null, "cv")).toBeNull();
  });
});

describe("normalizeModelKey", () => {
  it("strips fuel/trim suffix off numeric codes", () => {
    expect(normalizeModelKey("320d")).toBe("320");
    expect(normalizeModelKey("116i")).toBe("116");
    expect(normalizeModelKey("520")).toBe("520");
  });
  it("keeps word models intact", () => {
    expect(normalizeModelKey("Golf")).toBe("golf");
    expect(normalizeModelKey("A4")).toBe("a4");
  });
});
