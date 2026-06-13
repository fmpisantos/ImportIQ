---
title: Robust PT price estimate — median + mileage regression, not a flat mean
created: 2026-06-13
status: done
completed: 2026-06-13
priority: high
---

> **Outcome (2026-06-13):** Added pure `median`, `regressionEstimate` (OLS on
> mileage, requires ≥6 points + negative slope + R²≥0.15, prediction clamped to
> the observed price range) and `estimateMarketValue` (regression → median →
> mean) to `ptMarketClient.js`. `finalizeComparison` now carries `avgPriceEur`
> (mean, back-compat) + `marketValueEur` + `marketValueMethod` + `medianPriceEur`;
> `attachComparison` takes the verdict against `marketValueEur`. Per-source
> extractors pull each comparable's mileage/year so the regression has data.
> Covered by new tests in `test/ptMarket.test.js`. UI shows the method in the PT
> popover.

## What
After IQR trimming the comparison still uses a plain **mean** over a ±1yr /
±20,000km window — a 20k-km spread is worth €2–4k, so the mean blurs exactly
the signal we want. Replace with a robust estimate:

- **Median** as the default central tendency (more robust than the mean to the
  residual skew that survives the IQR fence).
- **Mileage regression**: fit price vs mileage (OLS) over the comparables and
  predict the price *at the subject listing's mileage*; fall back to median,
  then mean, when there are too few points or the fit is weak/degenerate.
- Carry `marketValueEur` + `marketValueMethod` so the verdict uses the best
  estimate and the UI can show how it was derived.

## Why
A flat window average makes the saving noisy. Predicting at the subject's exact
mileage is materially more accurate where comparables span a wide km range.

## Notes
- Pure functions in `ptMarketClient.js` (`median`, `regressionEstimate`,
  `estimateMarketValue`) — fully unit-testable.
- Needs each comparable's mileage/year — extend the per-source extractors to
  pull `quilometros`/`year` (OLX) etc.
- Clamp the regression prediction to the observed price range (no extrapolation
  blow-ups).
