/**
 * Brand → model map for the filter form (Specification §3.2, §11).
 *
 * In `mock` mode the map is derived from the fixture data so the form only
 * offers searchable combinations. In `live` mode we serve a curated static map
 * of common brands + trim-number model tokens (the cross-source join key — §4.2,
 * Appendix A.1); resolving each source's full taxonomy on demand is out of scope.
 */

import type { BrandsResponse } from "@importiq/shared";
import { config } from "../config.js";
import { MOCK_BRANDS } from "../adapters/fixtures.js";

const LIVE_BRANDS: BrandsResponse["brands"] = [
  { name: "BMW", models: ["116", "118", "120", "316", "318", "320", "330", "520", "530", "X1", "X2", "X3", "X5"] },
  { name: "Mercedes-Benz", models: ["A 180", "A 200", "C 200", "C 220", "E 220", "GLA", "GLC"] },
  { name: "Audi", models: ["A1", "A3", "A4", "A5", "A6", "Q2", "Q3", "Q5"] },
  { name: "VW", models: ["Polo", "Golf", "Passat", "Tiguan", "T-Roc"] },
  { name: "Porsche", models: ["Macan", "Cayenne", "911", "Panamera"] },
  { name: "Toyota", models: ["Yaris", "Corolla", "C-HR", "RAV4"] },
  { name: "Skoda", models: ["Fabia", "Octavia", "Superb", "Kamiq", "Karoq"] },
  { name: "Tesla", models: ["Model 3", "Model Y", "Model S"] },
];

export function getBrands(): BrandsResponse {
  return { brands: config.sourceMode === "mock" ? MOCK_BRANDS : LIVE_BRANDS };
}
