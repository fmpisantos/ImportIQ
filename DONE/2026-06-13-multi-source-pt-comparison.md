---
title: Multi-source PT market comparison (Standvirtual + AS24-PT alongside OLX.pt)
created: 2026-06-13
status: done
completed: 2026-06-13
priority: high
---

> **Outcome (2026-06-13):** Shipped a multi-source orchestrator
> (`adapters/direct/ptComparison.js`) that fans out to OLX.pt + Standvirtual,
> merges + URL-dedupes their comparables, then runs the shared finalize (IQR →
> robust estimate). `direct/olxpt.js` was refactored to expose a raw paginated
> `fetchComparables` (offset, up to 100) while keeping `getComparisonDirect` for
> back-compat; new `direct/standvirtual.js` parses the OTOMOTO `__NEXT_DATA__`
> (best-effort, tolerant, per-source count surfaced). `ptmarket.js` now calls the
> combiner (cache bumped v4→v5; empty results no longer cached). `PT_SOURCES`
> config added (`getPtSourcesConfig`, default `olx,standvirtual`). Each source is
> independent (Promise.allSettled).
>
> **Correction:** the original plan named **AutoScout24-PT** as the second
> source — but AutoScout24 does **not** operate a Portugal marketplace (its
> countries are DE/AT/BE/ES/FR/IT/LU/NL), so `cy=P` returns nothing. Dropped it
> and used **Standvirtual** (the actual PT market leader) instead. Covered by
> `test/standvirtual.test.js` + `test/ptComparison.test.js`.

## What
The PT average is built from a single source (OLX.pt) on the keyless path. OLX
skews toward private sellers / lower asking prices, so the benchmark is biased
low and samples are often tiny (constant `lowConfidence`). Add more keyless PT
sources and merge their comparables before averaging:

- **AutoScout24-PT** — reuse the existing AS24 scraper with `country='P'`.
- **Standvirtual** — largest PT marketplace, closer to dealer/resale prices.
- Merge → dedupe across sources → shared model/fuel/transmission/power filter →
  IQR trim → single robust estimate.
- Paginate the OLX query so popular models aren't truncated at one page.

## Why
More sources = bigger, less biased sample = an accurate PT benchmark, which is
the core value of the product. Standvirtual in particular reflects the prices
you'll actually *resell* at.

## Notes
- Refactor `direct/olxpt.js` to expose a raw `fetchComparables(listing)`; keep
  `getComparisonDirect` (OLX-only) for back-compat + existing tests.
- New `direct/as24pt.js`, `direct/standvirtual.js`, orchestrator
  `direct/ptComparison.js`; `ptmarket.js` calls the orchestrator.
- Config `pt_sources` (default `olx,as24pt`); Standvirtual opt-in pending live
  field verification (mirrors the README PT read-access caveat).
- Each source independently tolerant (Promise.allSettled) — one failing source
  never sinks the comparison.
