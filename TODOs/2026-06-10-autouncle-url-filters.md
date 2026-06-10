---
title: Encode price/year/mileage into the AutoUncle search URL
created: 2026-06-10
status: todo
priority: low
---

## What
The AutoUncle adapter only encodes make/model into the search-URL path; price,
year, mileage and fuel are enforced afterwards by the shared post-filter. Encode
those into the AutoUncle URL query string too, so the scraper fetches fewer
irrelevant pages.

## Why
Correctness is already guaranteed by the post-filter, but pushing the filters to
the source reduces pages scraped → lower Apify cost and faster runs, especially
on broad queries.

## Notes
- Adapter: `server/src/adapters/sites/autouncle.js` (`buildInput`).
- Confirm AutoUncle's real query-param names per locale (e.g. max price, min
  year, max km) before adding — wrong params could 404 or be ignored.
- mobile.de / AutoScout24 already push these via structured actor inputs.
