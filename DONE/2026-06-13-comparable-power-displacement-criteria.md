---
title: Tighter similar-car criteria — match on engine power & displacement
created: 2026-06-13
status: done
completed: 2026-06-13
priority: medium
---

> **Outcome (2026-06-13):** Generalised `comparableMatches` into
> `ptMarketClient.js` (shared by OLX + Standvirtual) with power (±20%) and
> displacement (±15%) tolerances, field-tolerant (only narrows when both sides
> publish). Per-source extractors now carry `powerKw` (cv→kW converted) and
> `displacementCm3`, parsed with a new `leadingInt` helper so a unit ending in a
> digit ("1995 cm3") isn't mis-read by `intFrom`'s digit-concatenation. Covered
> by tests in `test/ptMarket.test.js` + `test/standvirtual.test.js`.

## What
Comparable matching currently narrows on model-family + fuel + transmission
only. A 320d 150hp vs 190hp, or base vs M-Sport, differ €3–5k. OLX returns
`engine_power` (cv) and `engine_capacity` (cm³) per offer — use them:

- Add a power-band match (within ~±20%) and a displacement tolerance (~±15%)
  to the shared comparable matcher, missing-field-tolerant like the rest.

## Why
Engine/trim is one of the biggest price drivers within a model+year — matching
it removes a major source of noise from the PT average.

## Notes
- Generalise `comparableMatches` into `ptMarketClient.js` so every PT source
  uses one matcher; extend the per-source extractors to carry `powerCv` /
  `displacementCm3`.
- Keep it lenient: only narrow when both sides publish the field.
