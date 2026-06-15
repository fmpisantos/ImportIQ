// Official Portuguese ISV tables (OE2025 reforms, maintained in OE2026).
// These are statutory values, hardcoded by design — they change at most once a
// year per the Orçamento do Estado (OE). See PLAN.md §4.1.
//
// Each table is a list of brackets evaluated top to bottom. The first bracket
// whose `max` is >= the input value applies. `max: Infinity` is the catch-all.

// --- Cylinder component (passenger cars, gasoline & diesel) -----------------
// component = displacement_cm3 * ratePerCm3 - deduction
export const CYLINDER_BRACKETS = [
  { max: 1000, ratePerCm3: 1.09, deduction: 849.03 },
  { max: 1250, ratePerCm3: 1.18, deduction: 850.69 },
  { max: Infinity, ratePerCm3: 5.61, deduction: 6194.88 },
];

// --- Environmental component ------------------------------------------------
// component = co2_g_km * ratePerGkm - deduction
//
// Keyed by `${fuel}.${standard}`. Fuel is normalised to 'gasoline' | 'diesel';
// standard is 'WLTP' | 'NEDC'.
export const ENVIRONMENTAL_BRACKETS = {
  // Corrected 2026-06-15: the upper brackets (>195 g/km) were outdated and the
  // "196–235 / >235" split was missing. Replaced with the values from the
  // official legal text (Código do ISV art. 7º, informador.pt) confirmed
  // byte-for-byte by contasconnosco.cofidis.pt. The first six brackets were
  // already correct. Surfaced by the automated refresh job.
  'gasoline.WLTP': [
    { max: 110, ratePerGkm: 0.44, deduction: 43.02 },
    { max: 115, ratePerGkm: 1.1, deduction: 115.8 },
    { max: 120, ratePerGkm: 1.38, deduction: 147.79 },
    { max: 130, ratePerGkm: 5.27, deduction: 619.17 },
    { max: 145, ratePerGkm: 6.38, deduction: 762.73 },
    { max: 175, ratePerGkm: 41.54, deduction: 5819.56 },
    { max: 195, ratePerGkm: 51.38, deduction: 7247.39 },
    { max: 235, ratePerGkm: 193.01, deduction: 34190.52 },
    { max: Infinity, ratePerGkm: 233.81, deduction: 41910.96 },
  ],
  'gasoline.NEDC': [
    { max: 99, ratePerGkm: 4.62, deduction: 427.0 },
    { max: 115, ratePerGkm: 8.09, deduction: 750.99 },
    { max: 145, ratePerGkm: 52.56, deduction: 5903.94 },
    { max: 175, ratePerGkm: 61.24, deduction: 7140.17 },
    { max: 195, ratePerGkm: 155.97, deduction: 23627.27 },
    { max: Infinity, ratePerGkm: 205.65, deduction: 33390.12 },
  ],

  // Official diesel (gasóleo) environmental component — OE2025, unchanged in
  // OE2026 (2024 = 2025 = 2026). Diesel rates are substantially higher than
  // gasoline; the €500 particle surcharge (see DIESEL_PARTICLE_SURCHARGE_EUR)
  // is applied separately in isv.js. Verified 2026-06-15 against three
  // independent sources that agree exactly:
  //   - impostosobreveiculos.info/isv/imposto-sobre-veiculos-isv-2026
  //   - ecoimport.pt/isv-2026-novas-regras
  //   - contasconnosco.cofidis.pt/impostos/isv-escaloes-calcular
  // NOTE: diesel.NEDC was confirmed by two of those sources (WLTP by all three);
  // a final cross-check against the Portal das Finanças simulator is advisable
  // before treating NEDC as fully authoritative. These are statutory values —
  // change at most once a year per the OE, never estimate them.
  'diesel.WLTP': [
    { max: 110, ratePerGkm: 1.72, deduction: 11.5 },
    { max: 120, ratePerGkm: 18.96, deduction: 1906.19 },
    { max: 140, ratePerGkm: 65.04, deduction: 7360.85 },
    { max: 150, ratePerGkm: 127.4, deduction: 16080.57 },
    { max: 160, ratePerGkm: 160.81, deduction: 21176.06 },
    { max: 170, ratePerGkm: 221.69, deduction: 29227.38 },
    { max: 190, ratePerGkm: 274.08, deduction: 36987.98 },
    { max: Infinity, ratePerGkm: 282.35, deduction: 38271.32 },
  ],
  'diesel.NEDC': [
    { max: 79, ratePerGkm: 5.78, deduction: 439.04 },
    { max: 95, ratePerGkm: 23.45, deduction: 1848.58 },
    { max: 120, ratePerGkm: 79.22, deduction: 7195.63 },
    { max: 140, ratePerGkm: 175.73, deduction: 18924.92 },
    { max: 160, ratePerGkm: 195.43, deduction: 21720.92 },
    { max: Infinity, ratePerGkm: 268.42, deduction: 33447.9 },
  ],
};

// Provenance for the statutory tables above. Bump TABLES_VERSION when the OE
// changes the brackets so caches / overrides can detect staleness.
export const TABLES_VERSION = 'OE2026';
export const TABLES_SOURCE_NOTE =
  'Statutory ISV tables (OE2025, unchanged in OE2026). Change at most once a ' +
  'year per the Orçamento do Estado — never estimate.';

// --- Age reduction (applied to both components, 2025+) ----------------------
// Bracket is chosen by full years of vehicle age.
export const AGE_REDUCTION_BRACKETS = [
  { maxYears: 0, reduction: 0.0 }, // less than 1 year
  { maxYears: 1, reduction: 0.1 },
  { maxYears: 2, reduction: 0.2 },
  { maxYears: 3, reduction: 0.28 },
  { maxYears: 4, reduction: 0.35 },
  { maxYears: 5, reduction: 0.4 },
  { maxYears: 6, reduction: 0.52 },
  { maxYears: 7, reduction: 0.6 },
  { maxYears: 8, reduction: 0.65 },
  { maxYears: 9, reduction: 0.7 },
  { maxYears: Infinity, reduction: 0.8 }, // 10+ years
];

// Diesel particle surcharge, added when particle emissions >= 0.001 g/km.
export const DIESEL_PARTICLE_SURCHARGE_EUR = 500;

// Minimum ISV payable for non-exempt vehicles.
export const MINIMUM_ISV_EUR = 100;
