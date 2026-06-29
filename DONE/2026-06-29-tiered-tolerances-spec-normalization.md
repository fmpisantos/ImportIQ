---
title: PT comparison — tiered tolerances & spec-normalized estimate
created: 2026-06-29
status: done
completed: 2026-06-29
priority: medium
---

Outcome: both shipped. C — `selectByEngineTier` prefers a tight ±12% power / ±8%
displacement band (requiring the field on both sides), falling back to the loose
±20%/±15% set when < MIN_RELIABLE_SAMPLE qualify; `engineTier` ('tight'|'loose'|
null) surfaced on the comparison + `matchedCriteria` and shown in the UI popover.
D — `multiRegressionEstimate` adds a two-predictor (mileage+power) OLS used by
`estimateMarketValue` as the top-preference method ('mileage-power-regression'),
guarded by ≥8 points, ≥3 distinct powers, non-singular system, negative mileage
slope, R²≥0.2, and range-clamped; falls back to mileage-only/median otherwise.
Unit tests in `test/ptMarket.test.js`; verified on live AutoScout24/OLX/Standvirtual
data (C narrows correctly and the confidence signal flags the smaller-sample
tradeoff; D stays conservative and falls back cleanly when a fit isn't real).

## What
Two remaining improvements to the PT like-for-like comparison. (Item B —
match-quality + dispersion confidence — shipped; see
`DONE/2026-06-29-comparison-confidence-signal.md`.)

- **C — tiered engine tolerances:** prefer a tightly engine-matched set (e.g. ±8%
  displacement, ±12% power); fall back to the current ±15%/±20% only when too few
  survive, and label which tier produced the value. The current tolerances mix a
  318d/330d into a 320d pool.
- **D — spec-normalized estimate:** extend `estimateMarketValue`'s regression from
  mileage-only to mileage + power (small multivariate OLS) so the value is predicted
  AT the subject's spec instead of pooling all variants. Only when enough points.

## Why
Confidence grading (B) now makes residual uncertainty visible, but the benchmark
itself can still be tightened: (C) wide engine tolerances admit adjacent variants,
and (D) a pooled central estimate doesn't normalize for the subject's actual spec.

## Notes
- All in `server/src/adapters/ptMarketClient.js` (`comparableMatches`,
  `estimateMarketValue`, `withinTolerance`/tolerance constants).
- The confidence signals from B (`engineMatch.ratio`, `dispersion`) give a natural
  way to decide when the tight tier has "too few" and to show which tier was used.
- Keep field-tolerant semantics — never drop a comparable for a field neither side
  publishes; downgrade confidence instead.
- Related: `2026-06-14-pt-comparison-model-granularity.md`.
