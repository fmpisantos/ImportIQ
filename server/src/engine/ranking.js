// Display ranking rules shared by every result path (stored deals, live computed
// sorts, live source-ordered pages) — pure, I/O-free, unit-testable.
//
// The one rule here: a car we could NOT benchmark against the Portuguese market
// must never outrank one we could, whatever the user sorted by. Without it the
// list's most prominent slots go to cars whose headline number is missing —
// "cheapest landed" would open with cars we can't value at all, and a
// mileage/year sort would scatter unjudgeable cars through the top of the page.
// Those cars are still shown (the user may want them), just never prioritised.

/**
 * Did this result get a real PT benchmark — enough matched Portuguese
 * comparables to stake a verdict on?
 *
 * `savingEur` is the honest single signal: attachComparison only sets it when
 * the landed cost is complete AND the comparison produced a market value AND
 * that comparison was reliable (see ptMarketClient.finalizeComparison — a
 * sample under MIN_RELIABLE_SAMPLE, or a model we couldn't match, is withheld).
 * So "no PT cars found", "too few to trust" and "not costable" all collapse to
 * the same answer: nothing to prioritise. Pure.
 */
export function hasPtBenchmark(result) {
  return result?.savingEur != null;
}

const noBenchmarkFirst = (a, b) =>
  Number(!hasPtBenchmark(a)) - Number(!hasPtBenchmark(b));

/**
 * Order computed results by a numeric key, with results lacking a PT benchmark
 * sunk below every benchmarked one, and null keys last within each tier
 * (incomplete listings have no saving/landed to rank by). Array.sort is stable,
 * so ties keep their incoming order. Pure.
 *
 * @param {object[]} computed    fully-computed result objects
 * @param {(r:object)=>number|null} sortValue  ranking key reader
 * @param {boolean} desc         true = high→low (savings/margin), false = low→high (landed)
 */
export function rankComputedResults(computed, sortValue, desc) {
  const rank = (v) => (v == null || Number.isNaN(v) ? null : v);
  return [...computed].sort((a, b) => {
    const tier = noBenchmarkFirst(a, b);
    if (tier !== 0) return tier;
    const av = rank(sortValue(a));
    const bv = rank(sortValue(b));
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return desc ? bv - av : av - bv;
  });
}

/**
 * Apply only the benchmark tier, preserving the incoming order within each tier
 * (Array.sort is stable). For lists already ordered by someone else — an AS24
 * page sorted source-side by price/year/mileage — where all we want is to stop
 * un-benchmarked cars taking the top slots. Pure.
 */
export function sinkWithoutPtBenchmark(results) {
  return [...results].sort(noBenchmarkFirst);
}
