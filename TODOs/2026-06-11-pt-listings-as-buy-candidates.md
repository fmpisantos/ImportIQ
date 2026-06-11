---
title: Include Portugal-located cars as buy candidates (zero import cost path)
created: 2026-06-11
status: todo
priority: medium
---

## What
Search currently only retrieves German listings (AS24 DE, optional mobile.de)
and uses PT data purely as the comparison benchmark. Per the user's framing
("**if** the car is not in Portugal **then** add import costs"), PT-located
listings should also be searchable as candidates: for those, landed cost =
asking price + (optional) legalisation-free costs, no ISV/transport — and the
same saving-vs-PT-market verdict applies (an under-priced PT car is also a
deal).

- Reuse the OLX.pt adapter (`direct/olxpt.js`) — and/or AutoScout24 with
  `cy=P` — as a listings source, not just a comparison source.
- Tag each listing with a `country` / `requiresImport` flag; `landedCost.js`
  skips ISV/transport/legalisation when no import is needed.
- Exclude a candidate listing from its own market-average comparison.

## Why
The product goal is "cars that are good deals to sell in Portugal" — the deal
can come from a cheap German import *or* a mispriced local listing. Covering
both makes the result list complete and lets the user compare the two paths
directly.

## Notes
- Dispatcher: `adapters/source.js` / `directSearch.js` — add PT sources behind
  a filter (e.g. `countries: ['DE','PT']`, default DE-only to preserve current
  behaviour).
- OLX.pt items often lack displacement/CO₂ — fine, no ISV needed when the car
  is already registered in PT; don't mark those Incomplete for missing ISV
  inputs.
- IUC for PT-registered cars still applies (already estimated from
  firstRegYear).
