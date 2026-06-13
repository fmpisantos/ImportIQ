// VAT (IVA) on intra-EU imports of "new means of transport" — pure engine.
//
// Under EU VAT rules a car is a *new means of transport* when, at the time it
// is brought into Portugal, it is EITHER ≤6 months old OR has ≤6,000 km. For
// such a car Portuguese IVA (23%) is due on import, ON TOP OF ISV — regardless
// of fuel (an electric car is ISV-exempt but still owes IVA when new). This is
// the single most verdict-flipping cost the tool was missing: a nearly-new car
// shows the biggest price gap precisely because ~€7k of IVA on a €30k car isn't
// yet in the landed cost.
//
// Data reality: scraped listings reliably carry mileage but rarely the exact
// registration month, so the ≤6-month test is only *certain* when the month is
// known. We therefore split the outcome:
//   - applicable  → VAT is (near-)certainly due (≤6,000 km, or a known reg date
//                   ≤6 months) → add it to the landed cost.
//   - suspect     → can't confirm ≤6 months from the year alone (registered in
//                   the current year) → DON'T add a number, but warn loudly and
//                   keep it out of the green "deal" badge.
//
// German-side caveat (warn only): whether German VAT was charged/refundable
// (margin-scheme vs "MwSt. ausweisbar") changes the effective net price for a
// business buyer — out of scope to compute, surfaced as a note.

const round2 = (n) => Math.round(n * 100) / 100;

// Statutory PT VAT rate (mainland). Like the ISV tables, a rare-change constant.
export const PT_VAT_RATE_PCT = 23;
const NEW_KM_LIMIT = 6000;
const NEW_AGE_MONTHS = 6;

/**
 * Assess intra-EU import VAT for one vehicle.
 *
 * @param {object} v
 * @param {number} [v.mileageKm]
 * @param {number} [v.ageYears]        full years since first registration
 * @param {number} [v.firstRegYear]
 * @param {number} [v.firstRegMonth]   1–12, when known (sharpens the ≤6mo test)
 * @param {number} [v.priceEur]        German asking price (VAT base, approx.)
 * @param {number} [v.referenceYear]   "now" year (for the month calc)
 * @param {number} [v.referenceMonth]  1–12
 * @param {number} [v.vatRatePct]      default 23
 * @returns {{ applicable:boolean, suspect:boolean, vatRatePct:number,
 *             vatEur:number|null, reasons:string[], notes:string[] }}
 */
export function assessVat(v = {}) {
  const {
    mileageKm,
    ageYears,
    firstRegYear,
    firstRegMonth,
    priceEur,
    referenceYear,
    referenceMonth,
    vatRatePct = PT_VAT_RATE_PCT,
  } = v;

  const reasons = [];
  const notes = [];

  const lowMileage = mileageKm != null && mileageKm <= NEW_KM_LIMIT;
  if (lowMileage) reasons.push(`≤${NEW_KM_LIMIT.toLocaleString()} km (${mileageKm.toLocaleString()} km)`);

  // Precise age in months only when we know the registration month and "now".
  let monthsKnown = null;
  if (firstRegYear != null && firstRegMonth != null && referenceYear != null && referenceMonth != null) {
    monthsKnown = (referenceYear - firstRegYear) * 12 + (referenceMonth - firstRegMonth);
  }
  const youngByMonths = monthsKnown != null && monthsKnown <= NEW_AGE_MONTHS;
  if (youngByMonths) reasons.push(`≤${NEW_AGE_MONTHS} months old (${monthsKnown} mo)`);

  const applicable = lowMileage || youngByMonths;

  // Registered this calendar year but month unknown — can't rule out ≤6 months.
  const suspect =
    !applicable && monthsKnown == null && ageYears != null && ageYears === 0;
  if (suspect) {
    reasons.push('registered this year — ≤6 months (and VAT) cannot be ruled out');
  }

  const vatEur =
    applicable && priceEur != null ? round2((priceEur * vatRatePct) / 100) : null;

  if (applicable || suspect) {
    notes.push(
      'German VAT treatment (margin-scheme vs "MwSt. ausweisbar") affects the real net price — verify before committing.'
    );
  }

  return { applicable, suspect, vatRatePct, vatEur, reasons, notes };
}
