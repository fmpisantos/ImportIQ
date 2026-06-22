/**
 * The `mock` PT source — returns fixture comparables for the subject's
 * brand + normalised model. Precise variant matching (§4.2–§4.3) is applied
 * afterwards by the comparison service, identically to the live sources.
 */

import type { NormalizedListing } from "@importiq/shared";
import { normalizeModelKey } from "../../domain/normalize.js";
import { MOCK_PT_COMPARABLES } from "../fixtures.js";
import type { PtFetchResult, PtSourceFetcher } from "./types.js";

export const mockPtSource: PtSourceFetcher = {
  id: "mock",
  async fetch(subject: NormalizedListing): Promise<PtFetchResult> {
    const brand = subject.brand.toLowerCase();
    const modelKey = normalizeModelKey(subject.model);
    const comparables = MOCK_PT_COMPARABLES.filter((c) => {
      if (c.brand.toLowerCase() !== brand) return false;
      const candidateKey = normalizeModelKey(c.model);
      return !!modelKey && !!candidateKey && candidateKey.includes(modelKey);
    });
    return { sourceId: "mock", comparables, error: null };
  },
};
