/**
 * OLX.pt secondary PT comparison fetcher (Specification §4.1).
 *
 * OLX.pt is the *secondary* source, merged when present. Standvirtual is the
 * primary and is explicitly dense enough to stand alone for common cars (§4.1),
 * so OLX is optional: until its field map is verified against the live site, this
 * adapter returns a clean "not configured" error and the merge logic skips it
 * gracefully (§4.1) — exactly as a temporarily-unavailable source would behave.
 *
 * The golden rule (§0) is why this is a deliberate skip rather than a guessed
 * scraper: a wrong PT comparison price is worse than one fewer source. To enable
 * OLX, implement `fetch()` against the OLX offers API and map to `PtComparable`
 * via the shared normalisers — no other layer needs to change.
 */

import type { NormalizedListing } from "@importiq/shared";
import type { PtFetchResult, PtSourceFetcher } from "./types.js";

export const olxPtSource: PtSourceFetcher = {
  id: "olxpt",
  async fetch(_subject: NormalizedListing): Promise<PtFetchResult> {
    return {
      sourceId: "olxpt",
      comparables: [],
      error: "OLX.pt adapter not yet configured (Standvirtual is primary).",
    };
  },
};
