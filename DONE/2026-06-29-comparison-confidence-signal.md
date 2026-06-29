---
title: PT comparison — match-quality + dispersion confidence signal
created: 2026-06-29
status: done
completed: 2026-06-29
priority: medium
---

## What
The saving was presented as a single number with no indication of how trustworthy
the underlying PT benchmark was. A €15k "saving" off a tiny, widely-spread, or
model-only-matched sample looked identical to one off a tight, engine-verified set.
Added a confidence signal that grades the benchmark and surfaces *why*.

## Why
Trim-tier matching (`DONE/2026-06-29-trim-tier-comparison-matching.md`) removed the
worst bias, but residual error remains when comparables are admitted on model-family
alone (PT ads often omit engine specs) or when asking prices are widely dispersed.
Making that visible stops a phantom profit from hiding behind a confident number.

## Outcome
- `adapters/ptMarketClient.js`:
  - `priceDispersion(items)` — robust relative spread (IQR ÷ median) + raw min/max.
  - `engineMatchStats(items, listing)` — how many comparables were engine-matched
    (power + displacement on both sides) vs model-only, and whether the subject
    even publishes engine specs.
  - `gradeConfidence({sampleSize, engine, dispersion, trimMatched})` — transparent
    demerit model → `high` / `medium` / `low` plus the contributing `factors`.
  - `finalizeComparison` now computes these over the SAME set backing the benchmark
    and returns `dispersion`, `engineMatch`, `confidence`, `confidenceFactors`.
- `engine/landedCost.js` — `attachComparison` surfaces `confidence` at result level.
- UI `web/src/components/ResultCard.jsx` + `styles.css`:
  - low-confidence savings get a muted, dashed, asterisked badge + a caution note;
  - the PT-market modal shows a colour-coded confidence block: level, asking range,
    middle-half spread %, engine-match count, and the human-readable factors.

Tests in `test/ptMarket.test.js` (dispersion, engine-match, grading, finalize
surfacing). All adapter/ptMarket/landedCost tests green; the 3 `settingsRoutes`
failures are pre-existing and unrelated.

## Follow-ups
Tiered tolerances (C) and spec-normalized estimate (D) remain in
`TODOs/2026-06-29-comparison-confidence-and-spec-normalization.md`.
