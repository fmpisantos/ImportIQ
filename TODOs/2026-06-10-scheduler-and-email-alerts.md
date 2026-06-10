---
title: Scheduler + email alerts for saved searches (PLAN §7)
created: 2026-06-10
status: todo
priority: medium
---

## What
Let users save a search and have the bot re-run it on a schedule, emailing them
when new matching listings appear (or when a good-deal threshold is crossed).

## Why
Specified in PLAN.md §7. The import opportunity is time-sensitive — good cars
sell fast — so proactive alerts are the core value over manual re-searching.

## Notes
- Reuse `searchListings` (`adapters/source.js`) + `computeLandedCost`.
- Needs: persisted saved-search rows, a scheduler (cron/interval), an email
  transport, and dedupe of already-seen listings per saved search.
- The Apify `listings_cache` already stores per-filter results; a "seen" set per
  saved search avoids re-alerting on the same ad.
