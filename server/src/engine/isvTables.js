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
  'gasoline.WLTP': [
    { max: 110, ratePerGkm: 0.44, deduction: 43.02 },
    { max: 115, ratePerGkm: 1.1, deduction: 115.8 },
    { max: 120, ratePerGkm: 1.38, deduction: 147.79 },
    { max: 130, ratePerGkm: 5.27, deduction: 619.17 },
    { max: 145, ratePerGkm: 6.38, deduction: 762.73 },
    { max: 175, ratePerGkm: 41.54, deduction: 5819.56 },
    { max: 195, ratePerGkm: 98.78, deduction: 16128.51 },
    { max: Infinity, ratePerGkm: 148.45, deduction: 25847.36 },
  ],
  'gasoline.NEDC': [
    { max: 99, ratePerGkm: 4.62, deduction: 427.0 },
    { max: 115, ratePerGkm: 8.09, deduction: 750.99 },
    { max: 145, ratePerGkm: 52.56, deduction: 5903.94 },
    { max: 175, ratePerGkm: 61.24, deduction: 7140.17 },
    { max: 195, ratePerGkm: 155.97, deduction: 23627.27 },
    { max: Infinity, ratePerGkm: 205.65, deduction: 33390.12 },
  ],

  // TODO(diesel): replace with the official diesel-specific rates. PLAN.md §4.1
  // notes diesel rates are "slightly higher" than gasoline but does not provide
  // the exact table. These mirror the gasoline tables as a placeholder so the
  // engine runs end-to-end — they MUST be corrected against the OE tables
  // before diesel results are treated as authoritative.
  'diesel.WLTP': [
    { max: 110, ratePerGkm: 0.44, deduction: 43.02 },
    { max: 115, ratePerGkm: 1.1, deduction: 115.8 },
    { max: 120, ratePerGkm: 1.38, deduction: 147.79 },
    { max: 130, ratePerGkm: 5.27, deduction: 619.17 },
    { max: 145, ratePerGkm: 6.38, deduction: 762.73 },
    { max: 175, ratePerGkm: 41.54, deduction: 5819.56 },
    { max: 195, ratePerGkm: 98.78, deduction: 16128.51 },
    { max: Infinity, ratePerGkm: 148.45, deduction: 25847.36 },
  ],
  'diesel.NEDC': [
    { max: 99, ratePerGkm: 4.62, deduction: 427.0 },
    { max: 115, ratePerGkm: 8.09, deduction: 750.99 },
    { max: 145, ratePerGkm: 52.56, deduction: 5903.94 },
    { max: 175, ratePerGkm: 61.24, deduction: 7140.17 },
    { max: 195, ratePerGkm: 155.97, deduction: 23627.27 },
    { max: Infinity, ratePerGkm: 205.65, deduction: 33390.12 },
  ],
};

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
