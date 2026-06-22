/**
 * Portuguese comparison source dispatcher (Specification §4.1). Standvirtual is
 * primary; OLX.pt is secondary and merged when present.
 */

import { config } from "../../config.js";
import { mockPtSource } from "./mock.js";
import { olxPtSource } from "./olxpt.js";
import { standvirtualPtSource } from "./standvirtual.js";
import type { PtSourceFetcher } from "./types.js";

export function getActivePtSources(): PtSourceFetcher[] {
  if (config.ptSourceMode === "mock") return [mockPtSource];
  return [standvirtualPtSource, olxPtSource];
}
