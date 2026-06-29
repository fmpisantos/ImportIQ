---
title: PT comparison — match on trim tier so base cars aren't valued against sport trims
created: 2026-06-29
status: done
completed: 2026-06-29
priority: high
---

## What
The PT comparison collapsed every car to its model *family* ("320d" → "320") and
discarded the trim, so a base 320 and a 320 "M Sport" (often €8–12k of factory
options) were averaged as the same car. That inflated the PT market value and
manufactured phantom import profit — the user's core complaint ("not a true 1-to-1
comparison… we are not actually retrieving any profit").

Added a coarse **trim-tier** dimension (base / sport / performance) captured on
both the foreign listing and the PT comparables, and used it to match like-for-like.

## Why
A real like-for-like benchmark is the whole point of the product. Without trim
awareness the saving/verdict was systematically optimistic whenever the PT market
skewed to sport/loaded trims.

## Outcome
- New pure classifier `server/src/engine/trim.js` (`classifyTrim`, `trimTierOf`,
  `strongerTier`) — conservative multi-word marker dictionaries (M Sport / Pack M,
  AMG Line, S line, R-Line, N Line, ST-Line, GT Line, RS line → sport; M2–M8,
  M###i, AMG, RS#, S3–S8, SQ#, GTI/GTD/Golf R, Cupra, vRS, Nismo → performance).
  Sport phrases are stripped before performance patterns run so "RS line"/"AMG Line"
  can't misread as a full RS/AMG. Full unit coverage in `test/trim.test.js`.
- `trimTier` (+ raw `variant`) now set on listings in
  `adapters/direct/autoscout24.js` (card + detail-page refinement via
  `strongerTier`) and all three Apify site adapters; and on comparables in
  `adapters/direct/olxpt.js` and `standvirtual.js` (from the ad title/version).
- `adapters/ptMarketClient.js`:
  - `comparableMatches` — **hard-excludes** a comparable when exactly one side is
    `performance` (a categorically different car, not a trim).
  - new `selectByTrim` + `finalizeComparison` — **soft tier-preference**: narrow to
    same-tier comparables when ≥ MIN_RELIABLE_SAMPLE survive, else fall back to the
    full set and flag `trimMatched: false`. Surfaces `trimTier`, `trimMatched`,
    `trimBreakdown`, and `matchedCriteria.trimTier`.
- UI: `web/components/ResultCard.jsx` shows the matched tier, a like-for-like
  confirmation, and a caution when the trim couldn't be matched (with per-tier
  counts).

All new + existing adapter/ptMarket tests green (the 3 `settingsRoutes` failures
are pre-existing on a clean tree, unrelated).

## Follow-ups
- Deferred B/C/D options logged in `2026-06-29-comparison-confidence-and-spec-normalization.md`.
- Model-*line* granularity (Range Rover vs Velar/Sport) is a separate axis still
  open in `2026-06-14-pt-comparison-model-granularity.md`; the new `variant` field
  is the data lever it called for.
