// German-price sanity check — pure, no I/O (like the ISV engine).
//
// A mis-parsed or non-standard German price (a damaged/parts/export listing, or
// a monthly-financing figure scraped instead of the sale price) understates the
// landed cost and fakes a "great deal" — the mirror of the PT over-average bug.
// We can't know the true price, but we can flag the implausible ones two ways
// and let the user verify instead of silently averaging a bad number into a
// misleading saving:
//
//   1. Absolute floor — below it, a running importable car is implausible.
//   2. Same-model outlier — far below the median price of the other listings of
//      the same brand+model in this very run (needs a few peers to be trusted).
//
// Flagged results keep their numbers but are marked so the UI warns and the
// "deal" badge stays neutral.

const ABSOLUTE_FLOOR_EUR = 1200; // a running, importable car under this is implausible
const RELATIVE_RATIO = 0.45; // < 45% of the same-model median ⇒ suspicious
const MIN_GROUP = 4; // need this many priced peers before the median is trustworthy

const norm = (s) => String(s ?? '').trim().toLowerCase();
const groupKey = (listing) => `${norm(listing?.brand)}|${norm(listing?.model)}`;

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Annotate a results array (each item has `listing.priceEur`) with a
 * `germanPriceSuspicious` flag + human `germanPriceNotes` for any implausibly
 * low German price. Pure — returns a new array; unflagged items are returned
 * unchanged.
 *
 * @param {Array<{listing:object}>} results
 */
export function annotateGermanPriceSanity(results) {
  const priceOf = (r) => Number(r?.listing?.priceEur);

  const groups = new Map();
  for (const r of results) {
    const p = priceOf(r);
    if (!Number.isFinite(p) || p <= 0) continue;
    const k = groupKey(r.listing);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const medians = new Map();
  for (const [k, prices] of groups) {
    if (prices.length >= MIN_GROUP) medians.set(k, median(prices));
  }

  return results.map((r) => {
    const p = priceOf(r);
    if (!Number.isFinite(p) || p <= 0) return r;
    const notes = [];
    if (p < ABSOLUTE_FLOOR_EUR) {
      notes.push(
        `German price €${p.toLocaleString()} is below €${ABSOLUTE_FLOOR_EUR.toLocaleString()} — implausible for a running car (possible parts/damaged listing or a price-parse error).`
      );
    }
    const med = medians.get(groupKey(r.listing));
    if (med != null && p < RELATIVE_RATIO * med) {
      notes.push(
        `German price €${p.toLocaleString()} is only ${Math.round(
          (p / med) * 100
        )}% of the same-model median (€${Math.round(med).toLocaleString()}) — verify it isn't damaged or mis-parsed.`
      );
    }
    return notes.length ? { ...r, germanPriceSuspicious: true, germanPriceNotes: notes } : r;
  });
}
