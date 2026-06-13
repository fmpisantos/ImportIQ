---
title: AutoScout24 model filter is ignored server-side (few real matches per search)
created: 2026-06-13
status: todo
priority: high
---

## What
The direct AS24 search builds `/lst/{make}/{model}` (e.g. `/lst/bmw/320d`), but
AS24 does **not** filter by that path segment — verified live 2026-06-13: the
URL returns 150 mixed BMWs (X3, X5, 520, 116…), of which only ~5 are actually
"320". Our defensive `matchesFilters` then correctly drops the rest, so a
model-specific search surfaces only a handful of real matches even though we
fetched a full 150-card pool. This is why a "320d" search shows very few results
(and limits how much pagination can show).

Root cause: AS24's model taxonomy is the **series** ("3er"), not the variant
("320d"/"320"). A variant slug isn't a valid model node, so AS24 ignores it and
returns the whole make.

## Why
The product's value is finding deals for a specific model; returning ~5 of 150
fetched cards both starves the result list and wastes the fetch. Fixing this
multiplies usable results per search (and makes pagination meaningful for model
searches).

## Notes
- Options: (a) map the user's model → AS24 series slug + variant query param
  (needs AS24's make/model id tree, like the mobile.de refdata cache); (b) use
  AS24's `?mmvmk0/mmvmd0` numeric make/model ids; (c) fetch more pages and rely
  on the post-filter (cheap but low yield — 320d is sparse among all BMW).
- The PT side hit the same class of problem and was solved with the verified
  `filter_enum_model` enum (OLX category / Standvirtual) — AS24 needs its own
  equivalent.
- Files: `server/src/adapters/direct/autoscout24.js` (`buildSearchUrl`,
  `searchAutoScout24`), `server/src/adapters/brands.js`.
- Related: server-side pagination now computes one page at a time, so client
  sort only orders the current page — a cross-page sort (or server-side sort on
  the cheap card fields) is a smaller follow-up once pools are model-accurate.
