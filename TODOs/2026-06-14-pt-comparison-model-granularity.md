---
title: PT comparison — coarse German model labels pull in wrong trim/line
created: 2026-06-14
status: todo
priority: medium
---

## What
When the German listing's `model` is a broad label (e.g. just "Range Rover"
rather than "Range Rover Velar"), the PT comparable matcher still matches every
more-specific trim under that label — so a base "Range Rover" subject is compared
against "Range Rover Sport" and "Range Rover Velar" listings, which are different
vehicle lines at different price points.

This is the residual case after the 2026-06-14 fix
(`comparableMatches` now matches one-directionally: comparable must CONTAIN the
subject model, never the reverse). That killed the worst mismatch (a Velar
subject matching the flagship Range Rover), but a genuinely under-specified
subject label still over-matches *downward* into pricier trims.

## Why
A Range Rover subject at €27,990 (DE) still surfaced as a ~€14.5k deal against an
n=3 set that includes Sport/Velar trims. The number is now sample-backed and far
less wrong than before, but the model granularity on the German side is the
limiting factor.

## Notes
- Root cause is data quality on the *source* (AutoScout24) side: the line/trim
  isn't always captured into `listing.model`. Improving model extraction in the
  AS24 adapter (`adapters/direct/autoscout24.js`) would help most.
- Engine power/displacement tolerances don't separate these (RR Sport SDV6
  ~225kW vs Velar 3.0d ~221kW vs subject 190kW are all within ±20%).
- Possible mitigations: (a) require a trim/sub-line token when the brand has
  known overlapping lines; (b) widen the min-sample floor for known
  multi-line families; (c) surface the matched comparables' titles in the UI so
  the user can eyeball a line mismatch.
- Related: `2026-06-14-pt-comparison-mismatch-model-null-and-cache-collision.md`
  (DONE), `2026-06-13-pt-average-comparable-accuracy.md` (DONE).
