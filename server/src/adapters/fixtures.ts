/**
 * Deterministic mock data (Specification §3.6, §10): no network, no credentials.
 * Used by the `mock` German source and `mock` PT source so the whole flow —
 * search → comparison → landed cost → results — is testable offline.
 *
 * The data is shaped to exercise the trust rules: most cars have complete specs
 * and matching PT comparables (so a real saving shows), one is electric (ISV
 * exempt), and one is missing CO₂/displacement (forces an Incomplete result).
 */

import type { NormalizedListing } from "@importiq/shared";
import type { PtComparable } from "../domain/comparison/types.js";

const EURO6 = "Euro6d-TEMP";

function de(
  id: string,
  brand: string,
  model: string,
  variant: string,
  priceEur: number,
  mileageKm: number,
  firstRegistration: string,
  fuelType: NormalizedListing["fuelType"],
  engineCc: number | null,
  co2Gkm: number | null,
  powerKw: number | null,
  transmission: NormalizedListing["transmission"] = "automatic",
): NormalizedListing {
  return {
    sourceId: "mock",
    sourceListingId: id,
    url: `https://example.com/de/${id}`,
    title: `${brand} ${model} ${variant}`,
    subtitle: variant,
    brand,
    model,
    modelGroup: null,
    variant,
    priceEur,
    mileageKm,
    firstRegistration,
    fuelType,
    transmission,
    engineCc,
    co2Gkm,
    emissionStandard: fuelType === "electric" ? null : EURO6,
    powerKw,
    imageUrl: `https://picsum.photos/seed/${id}/320/200`,
    location: "DE",
  };
}

export const MOCK_GERMAN_LISTINGS: NormalizedListing[] = [
  de("de-bmw-320-1", "BMW", "320", "d Touring M Sport", 22000, 48000, "2020-03", "diesel", 1995, 126, 140),
  de("de-bmw-320-2", "BMW", "320", "d xDrive", 23500, 39000, "2021-06", "diesel", 1995, 128, 140),
  de("de-bmw-320-3", "BMW", "320", "i Advantage", 21000, 55000, "2019-09", "petrol", 1998, 142, 135),
  de("de-bmw-520-1", "BMW", "520", "d Business", 28000, 62000, "2020-01", "diesel", 1995, 132, 140),
  de("de-bmw-x3-1", "BMW", "X3", "xDrive20d", 31000, 58000, "2020-05", "diesel", 1995, 152, 140),
  de("de-audi-a4-1", "Audi", "A4", "40 TDI S line", 26000, 51000, "2020-04", "diesel", 1968, 124, 140),
  de("de-audi-a4-2", "Audi", "A4", "35 TFSI", 24000, 44000, "2021-02", "petrol", 1984, 138, 110),
  de("de-audi-a3-1", "Audi", "A3", "Sportback 30 TFSI", 19500, 42000, "2020-08", "petrol", 999, 118, 81),
  de("de-vw-golf-1", "VW", "Golf", "1.5 TSI Life", 18500, 47000, "2020-07", "petrol", 1498, 120, 110),
  de("de-vw-golf-2", "VW", "Golf", "2.0 TDI Style", 19800, 53000, "2020-11", "diesel", 1968, 115, 110),
  de("de-vw-passat-1", "VW", "Passat", "2.0 TDI Elegance", 23000, 68000, "2020-02", "diesel", 1968, 128, 110),
  de("de-toyota-corolla-1", "Toyota", "Corolla", "1.8 Hybrid", 20500, 41000, "2021-03", "hybrid", 1798, 102, 90),
  de("de-tesla-model3-1", "Tesla", "Model 3", "Long Range", 33000, 38000, "2021-05", "electric", null, 0, 324),
  // Incomplete: missing both displacement and CO₂ → landed cost must be Incomplete.
  de("de-bmw-320-incomplete", "BMW", "320", "d (specs missing)", 20500, 60000, "2019-04", "diesel", null, null, null),
];

function pt(
  id: string,
  sourceId: PtComparable["sourceId"],
  brand: string,
  model: string,
  variant: string,
  priceEur: number,
  mileageKm: number,
  year: number,
  fuelType: PtComparable["fuelType"],
  engineCc: number | null,
  powerKw: number | null,
  ratingIndicator: PtComparable["ratingIndicator"] = "IN",
): PtComparable {
  return {
    sourceId,
    url: `https://www.standvirtual.com/${id}`,
    title: `${brand} ${model} ${variant}`,
    brand,
    model,
    variant,
    priceEur,
    mileageKm,
    year,
    fuelType,
    engineCc,
    powerKw,
    ratingIndicator,
  };
}

export const MOCK_PT_COMPARABLES: PtComparable[] = [
  // BMW 320 diesel — dense pool
  pt("pt-320-1", "standvirtual", "BMW", "320", "d Pack M", 31000, 50000, 2020, "diesel", 1995, 140, "IN"),
  pt("pt-320-2", "standvirtual", "BMW", "320", "d Auto", 30500, 46000, 2020, "diesel", 1995, 140, "BELOW"),
  pt("pt-320-3", "standvirtual", "BMW", "320", "d xDrive", 32500, 38000, 2021, "diesel", 1995, 140, "IN"),
  pt("pt-320-4", "olxpt", "BMW", "320", "d", 29900, 58000, 2020, "diesel", 1995, 140, "BELOW"),
  pt("pt-320-5", "standvirtual", "BMW", "320", "d Line Sport", 33200, 41000, 2021, "diesel", 1995, 140, "ABOVE"),
  pt("pt-320-6", "standvirtual", "BMW", "320", "d Touring", 31500, 52000, 2020, "diesel", 1995, 140, "IN"),
  // BMW 320 petrol
  pt("pt-320i-1", "standvirtual", "BMW", "320", "i", 29500, 53000, 2019, "petrol", 1998, 135, "IN"),
  pt("pt-320i-2", "standvirtual", "BMW", "320", "i Pack", 30200, 49000, 2020, "petrol", 1998, 135, "IN"),
  pt("pt-320i-3", "olxpt", "BMW", "320", "i", 28900, 60000, 2019, "petrol", 1998, 135, "BELOW"),
  // BMW 520 diesel
  pt("pt-520-1", "standvirtual", "BMW", "520", "d", 37000, 60000, 2020, "diesel", 1995, 140, "IN"),
  pt("pt-520-2", "standvirtual", "BMW", "520", "d Auto", 38500, 55000, 2020, "diesel", 1995, 140, "IN"),
  pt("pt-520-3", "olxpt", "BMW", "520", "d Pack M", 36500, 64000, 2020, "diesel", 1995, 140, "BELOW"),
  // BMW X3 diesel
  pt("pt-x3-1", "standvirtual", "BMW", "X3", "20d xDrive", 41000, 60000, 2020, "diesel", 1995, 140, "IN"),
  pt("pt-x3-2", "standvirtual", "BMW", "X3", "20d", 39800, 55000, 2020, "diesel", 1995, 140, "BELOW"),
  pt("pt-x3-3", "olxpt", "BMW", "X3", "xDrive20d", 42500, 50000, 2021, "diesel", 1995, 140, "IN"),
  // Audi A4 diesel
  pt("pt-a4-1", "standvirtual", "Audi", "A4", "40 TDI", 33500, 52000, 2020, "diesel", 1968, 140, "IN"),
  pt("pt-a4-2", "standvirtual", "Audi", "A4", "Avant 40 TDI", 34800, 47000, 2020, "diesel", 1968, 140, "IN"),
  pt("pt-a4-3", "olxpt", "Audi", "A4", "2.0 TDI", 32500, 58000, 2020, "diesel", 1968, 140, "BELOW"),
  // Audi A4 petrol
  pt("pt-a4p-1", "standvirtual", "Audi", "A4", "35 TFSI", 31000, 45000, 2021, "petrol", 1984, 110, "IN"),
  pt("pt-a4p-2", "standvirtual", "Audi", "A4", "TFSI S line", 32200, 40000, 2021, "petrol", 1984, 110, "IN"),
  pt("pt-a4p-3", "olxpt", "Audi", "A4", "1.5 TFSI", 30100, 50000, 2020, "petrol", 1984, 110, "BELOW"),
  // Audi A3 petrol
  pt("pt-a3-1", "standvirtual", "Audi", "A3", "30 TFSI", 26000, 43000, 2020, "petrol", 999, 81, "IN"),
  pt("pt-a3-2", "standvirtual", "Audi", "A3", "Sportback", 26800, 39000, 2021, "petrol", 999, 81, "IN"),
  pt("pt-a3-3", "olxpt", "Audi", "A3", "1.0 TFSI", 25200, 48000, 2020, "petrol", 999, 81, "BELOW"),
  // VW Golf petrol
  pt("pt-golf-1", "standvirtual", "VW", "Golf", "1.5 TSI", 24500, 45000, 2020, "petrol", 1498, 110, "IN"),
  pt("pt-golf-2", "standvirtual", "VW", "Golf", "TSI Life", 25200, 41000, 2021, "petrol", 1498, 110, "IN"),
  pt("pt-golf-3", "olxpt", "VW", "Golf", "1.5", 23800, 52000, 2020, "petrol", 1498, 110, "BELOW"),
  // VW Golf diesel
  pt("pt-golfd-1", "standvirtual", "VW", "Golf", "2.0 TDI", 25500, 50000, 2020, "diesel", 1968, 110, "IN"),
  pt("pt-golfd-2", "standvirtual", "VW", "Golf", "TDI Style", 26200, 46000, 2021, "diesel", 1968, 110, "IN"),
  pt("pt-golfd-3", "olxpt", "VW", "Golf", "2.0 TDI", 24800, 58000, 2020, "diesel", 1968, 110, "BELOW"),
  // VW Passat diesel
  pt("pt-passat-1", "standvirtual", "VW", "Passat", "2.0 TDI", 30000, 65000, 2020, "diesel", 1968, 110, "IN"),
  pt("pt-passat-2", "standvirtual", "VW", "Passat", "Variant TDI", 31200, 60000, 2020, "diesel", 1968, 110, "IN"),
  pt("pt-passat-3", "olxpt", "VW", "Passat", "2.0 TDI", 29200, 72000, 2020, "diesel", 1968, 110, "BELOW"),
  // Toyota Corolla hybrid
  pt("pt-corolla-1", "standvirtual", "Toyota", "Corolla", "1.8 Hybrid", 27000, 42000, 2021, "hybrid", 1798, 90, "IN"),
  pt("pt-corolla-2", "standvirtual", "Toyota", "Corolla", "Hybrid Comfort", 27800, 38000, 2021, "hybrid", 1798, 90, "IN"),
  pt("pt-corolla-3", "olxpt", "Toyota", "Corolla", "Hybrid", 26200, 48000, 2021, "hybrid", 1798, 90, "BELOW"),
  // Tesla Model 3 electric
  pt("pt-m3-1", "standvirtual", "Tesla", "Model 3", "Long Range", 39500, 40000, 2021, "electric", null, 324, "IN"),
  pt("pt-m3-2", "standvirtual", "Tesla", "Model 3", "LR AWD", 40800, 36000, 2021, "electric", null, 324, "IN"),
  pt("pt-m3-3", "olxpt", "Tesla", "Model 3", "Long Range", 38500, 45000, 2021, "electric", null, 324, "BELOW"),
];

/** Brand → model tokens present in the mock data, for the filter form. */
export const MOCK_BRANDS: { name: string; models: string[] }[] = [
  { name: "BMW", models: ["320", "520", "X3"] },
  { name: "Audi", models: ["A3", "A4"] },
  { name: "VW", models: ["Golf", "Passat"] },
  { name: "Toyota", models: ["Corolla"] },
  { name: "Tesla", models: ["Model 3"] },
];
