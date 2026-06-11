---
title: "Good deal" verdict — saving threshold, confidence, deals-only view
created: 2026-06-11
status: todo
priority: high
---

## What
Turn the raw saving/premium number into an explicit **deal verdict** so a search
returns "the cars worth pursuing", not just every match:

- A configurable **minimum saving threshold** (absolute € and/or %) stored in
  the config DB (e.g. `deal.min_saving_eur`, `deal.min_saving_pct`).
- A **"deals only" toggle** on the results page that hides anything below the
  threshold, incomplete results, and results with no PT comparison.
- A **confidence signal** per result: the PT comparison is an average of asking
  prices — surface `sampleSize` (number of comparable PT listings) on the card
  and treat comparisons built on < N listings as low-confidence (no green badge).

## Why
This is the product's core promise: "give me a list of cars that are good deals
when I search". Today the API returns all matches and the UI only sorts
(`SearchPage.jsx` SORTS); the user still has to eyeball which ones are deals.
A threshold + confidence also feeds the alerting work
(2026-06-10-scheduler-and-email-alerts.md uses a "saving above threshold"
trigger that doesn't exist yet).

## Notes
- Verdict data already exists: `attachComparison()` in
  `server/src/engine/landedCost.js` produces `savingEur` / `savingPct`.
- PT comparison sample size: check what `getComparison()` returns
  (`adapters/ptmarket.js` / `direct/olxpt.js`) — expose listing count if not
  already there.
- Config rows fit the existing `cost_config` store (category `other`) or
  `active_settings`.
- Asking-price caveat: PT averages are *asking* prices, so the real margin on a
  resale is lower — keep the threshold conservative by default and label the
  badge "vs PT asking avg".
