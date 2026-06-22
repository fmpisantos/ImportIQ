/**
 * German source dispatcher (Specification §3.6). The rest of the app asks only
 * for "the active sources" and never knows which are live.
 */

import { config } from "../../config.js";
import { autoscout24Source } from "./autoscout24.js";
import { mockSource } from "./mock.js";
import type { SourceAdapter } from "./types.js";

export function getActiveSources(): SourceAdapter[] {
  if (config.sourceMode === "mock") return [mockSource];
  // Live: AutoScout24 is the primary keyless source. mobile.de is intentionally
  // pluggable/optional (anti-bot-gated, §3.5) and can be added as one adapter
  // here without touching the engine, comparison, or UI.
  return [autoscout24Source];
}
