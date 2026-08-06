---
title: "\"No PT match\" tooltip should explain the real reason, not always the sample size"
created: 2026-08-06
status: todo
priority: low
---

## What

`SavingBadge` in `web/src/components/ResultCard.jsx` picks its tooltip wording
from `comparison.sampleSize > 0`, so it always blames the sample size:

> Only 37 Portuguese comparables found — too few to stake a verdict on.

But a comparison is withheld on **two** independent counts (`ptMarketClient.js`
`finalizeComparison`): `reliable = hasModel && enoughSample`. When the failure is
`model-unknown`, the sample can be large and the tooltip is simply wrong.

Branch on `comparison.unreliableReason` (`'model-unknown'` |
`'insufficient-sample'` | `null`) instead of inferring from the count.

## Why

The badge exists to explain why a card sits at the bottom of the list (the
un-benchmarked ranking tier, `server/src/engine/ranking.js`). An explanation that
names the wrong cause is worse than none — the user would go looking for more
Portuguese listings when the actual problem is that we couldn't identify the
model well enough to search for it.

## Notes

- Narrow today: `direct` mode short-circuits model-unknown before fetching
  (`adapters/direct/ptComparison.js` trust gate) so `sampleSize` is 0 and the
  wording happens to be right. It bites on the `official` path, where
  `comparableMatches` skips the model gate when the subject has no model.
- Suggested third string: "We couldn't identify this car's model confidently
  enough to search the Portuguese market for it."
- Found during the 2026-08-06 review of the configurable-mileage-band /
  ranking-tier work; the other three findings from that review were fixed.
