// Trim-tier classifier (pure, I/O-free, unit-testable).
//
// The PT comparison historically collapsed a car to its model *family* ("320d" →
// "320") and threw the trim away, so a base 320 and a 320 "M Sport" (often €8–12k
// of factory options) were averaged as the same car — inflating the PT market
// value and inventing phantom import profit. This module recovers a coarse trim
// TIER from whatever free-text the source carries (AutoScout24's `vehicle.variant`,
// the OLX/Standvirtual ad `title`), so the matcher can compare like-for-like.
//
// Three tiers, cheapest → priciest:
//   - 'base'        : no recognised sport/performance marker.
//   - 'sport'       : a factory sport APPEARANCE package (M Sport, AMG Line,
//                     S line, R-Line, …) — same drivetrain, pricier spec.
//   - 'performance' : a genuinely different, hotter model (M3, RS6, AMG 63,
//                     GTI, Cupra, …). A categorical difference, not options.
//
// Deliberately CONSERVATIVE: markers are matched as whole, multi-word tokens so
// "M Sport" never trips on a bare "sport", and an unrecognised string falls back
// to 'base' rather than guessing. The tiers are heuristic and brand-shaped —
// extend the dictionaries below as new patterns show up. NEVER treat the result
// as ground truth: matching stays field-tolerant precisely because a short PT
// title routinely omits the trim it actually is.

/** De-accent, lowercase, collapse separators to single spaces. */
function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// --- Sport appearance packages (same car, richer spec) ----------------------
// Multi-word so they can't collide with a bare letter. Both the German/English
// marketing name and the common Portuguese rendering are listed.
const SPORT_PATTERNS = [
  /\bm sport(paket)?\b/, // BMW M Sport / M Sportpaket
  /\bpack m\b/, // BMW "Pack M" (PT listings)
  /\blinha m\b/, // BMW "Linha M" (PT listings)
  /\bamg line\b/, // Mercedes AMG Line
  /\blinha amg\b/,
  /\bs line\b/, // Audi S line (NOT S3/S4 — those need a digit, handled below)
  /\br line\b/, // VW / Audi R-Line
  /\bn line\b/, // Hyundai N Line
  /\bst line\b/, // Ford ST-Line
  /\bgt line\b/, // Kia / Peugeot GT Line
  /\brs line\b/, // Audi RS line
  /\blinha rs\b/,
];

// --- Genuine performance models (a different car, not a trim) ---------------
// Tested against the text AFTER sport phrases are stripped out, so a bare "amg"
// or "rs" here can't misfire on "AMG Line" / "RS line" (those are removed first).
const PERFORMANCE_PATTERNS = [
  /\bm[2-8]\b/, // BMW M2 … M8 (full M)
  /\bm\d{3}[id]?\b/, // BMW M Performance (M340i, M550d, …)
  /\bamg\b/, // Mercedes-AMG (C63, A45, …) — "AMG Line" already stripped
  /\brs\d?\b/, // Audi/Ford RS, RS3 … RS7 — "RS line" already stripped
  /\bs[3-8]\b/, // Audi S3 … S8
  /\bsq\d\b/, // Audi SQ5 / SQ7 / SQ8
  /\bgti\b/, // VW/Peugeot GTI
  /\bgtd\b/, // VW GTD
  /\bgolf r\b/, // VW Golf R
  /\bcupra\b/, // SEAT/Cupra performance line
  /\bvrs\b/, // Škoda vRS
  /\bnismo\b/, // Nissan Nismo
];

/**
 * Classify a free-text trim/variant/title string into a coarse tier.
 *
 * A sport-package phrase ("AMG Line", "RS line", "M Sport") is detected first and
 * then STRIPPED from the text before the performance patterns run — otherwise a
 * bare "amg"/"rs" inside "AMG Line"/"RS line" would wrongly read as a full
 * performance model. After stripping, a surviving performance marker wins (so
 * "M340i M Sport" → performance, the larger categorical price gap); else if a
 * sport phrase was present → 'sport'; else 'base'.
 *
 * @param {string} text  any string that may carry a trim name
 * @returns {{ tier: 'base'|'sport'|'performance', marker: string|null }}
 *   `marker` is the matched token (for debugging/transparency).
 */
export function classifyTrim(text) {
  const t = normalizeText(text);
  if (!t) return { tier: 'base', marker: null };

  const sportHit = SPORT_PATTERNS.find((re) => re.test(t)) ?? null;
  let residual = t;
  for (const re of SPORT_PATTERNS) residual = residual.replace(re, ' ');

  const perfHit = PERFORMANCE_PATTERNS.find((re) => re.test(residual)) ?? null;
  if (perfHit) return { tier: 'performance', marker: residual.match(perfHit)?.[0] ?? null };
  if (sportHit) return { tier: 'sport', marker: t.match(sportHit)?.[0] ?? null };
  return { tier: 'base', marker: null };
}

/** Convenience: just the tier string for the common case. */
export function trimTierOf(text) {
  return classifyTrim(text).tier;
}

/** The stronger (pricier) of two tiers — used when a detail page refines a card. */
const TIER_RANK = { base: 0, sport: 1, performance: 2 };
export function strongerTier(a, b) {
  return (TIER_RANK[b] ?? 0) > (TIER_RANK[a] ?? 0) ? b : a;
}
