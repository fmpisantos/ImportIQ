---
title: "A lot of cars without PT average" — root-caused to accented-label canonicalisation
created: 2026-06-13
completed: 2026-06-13
status: done
priority: high
---

## What
After the multi-source PT work shipped, many listings showed no PT average.
Investigated live and found the root cause + two contributing issues; all fixed.

## Root cause (the big one)
`canonicalTransmission` matched `/automat/` but OLX/Standvirtual return the
**accented** PT label **"Automática"**, which doesn't contain "automat" → it was
passed through un-canonicalised and never equalled a German car's `"Automatic"`.
Since premium German cars (the main targets) are mostly automatic, **every
automatic PT comparable was dropped → 0 comparables → no average.** Verified live:
OLX returned 53 "Automática" gearboxes for a BMW 320d, all dropped.

Fix: `canonicalFuel`/`canonicalTransmission` now **strip diacritics** before
matching (NFD + combining-mark removal), and the electric pattern was broadened
so PT "Elétrico"/"Híbrido" canonicalise too (same bug class, would have starved
EV/hybrid comparisons). Regression guards in `test/normalize.test.js`.

Result (live): BMW 320d **0 → 9** comparables, Audi A4 **0 → 3**, Mercedes C 220
**0 → 36**.

## Contributing fixes
- **Standvirtual now actually contributes.** It was fetching a brand-only page
  (mixed models) and matched ~0 of the target model, and read the wrong param
  keys. Fixed: send the verified `filter_enum_model` enum (e.g. "320d"→"320")
  with a brand-only fallback; read `first_registration_year` + the clean numeric
  `value` fields. Verified live: targeted model pages now return the right cars.
- **OLX pagination made fault-tolerant** — a failing page 2 no longer discards
  page 1's results.

## Notes
- PT cache bumped v5→v6 so pre-fix (small-sample) rows recompute.
- Files: `adapters/normalize.js`, `adapters/direct/standvirtual.js`,
  `adapters/direct/olxpt.js`, `adapters/ptmarket.js`.
- Separate discovery (own TODO): AS24 ignores the model path slug server-side —
  see `TODOs/2026-06-13-as24-model-server-filter.md`.
