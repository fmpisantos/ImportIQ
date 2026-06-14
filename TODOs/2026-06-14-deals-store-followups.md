---
title: Deals-store follow-ups (UI copy, admin recompute, cross-source collapse)
created: 2026-06-14
status: todo
priority: medium
---

## What

Loose ends deferred from the daily-batch deal-ingestion build (see
`DONE/2026-06-13-daily-batch-deal-ingestion.md`):

1. ~~**Frontend copy + empty-store UX.**~~ **Done 2026-06-14.** `SearchPage.jsx`
   now drives server-side sort (spans all pages), shows a `deal store` / `live
   scrape` source indicator, has a `↻ Refresh live` button (the `?live=1`
   path), and an empty-store hint pointing at `npm run ingest`. Button renamed
   "Run Bot" → "Search". Remaining nicety: a visible "store last ingested at"
   timestamp (needs a tiny stats endpoint) — not built.

2. **Admin "recompute all" / "re-check terminals".** A post-config-save action
   that recomputes stored `result_json` from `listing_json` without re-scraping
   (cheap — no network), and a rare manual sweep that re-fetches `source_missing`
   rows in case a source later starts publishing the field. Backend hooks exist
   (`config_version` invalidation, `enrich_status`); just need a route + button.

3. **Cross-source duplicate collapse at read time.** v1 keeps both rows
   (source-native PK) and stores `content_key` but does not collapse. When
   mobile.de joins via a saved key, add a read-time GROUP BY `content_key` in
   `getDealsPage` preferring the cheapest landed duplicate.

## Why

(1) is user-visible and mildly misleading today. (2) and (3) are correctness/UX
polish that the schema already anticipates. None block the core pipeline.

## Notes

- Ties into `2026-06-10-scheduler-and-email-alerts.md` (daily diff feeds alerts)
  and the `pt-listings-as-buy-candidates` work (the `country` column is already
  ingested).
- `getDealsPage` shows `status IN ('active','stale')`; only `sold` is hidden.
