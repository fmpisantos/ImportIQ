/**
 * Nightly scheduler (Specification §9).
 *
 * Safe by default: it only arms when `SCHEDULER_ENABLED=true`. Source pacing is
 * handled in the HTTP layer, and the job runs detached from request handling so
 * it never blocks or slows interactive use.
 */

import cron from "node-cron";
import { config } from "../config.js";
import { runAllBatches } from "../services/batchService.js";

export function startScheduler(): void {
  if (!config.schedulerEnabled) {
    console.log("[scheduler] disabled (set SCHEDULER_ENABLED=true to enable nightly batches)");
    return;
  }
  if (!cron.validate(config.schedulerCron)) {
    console.error(`[scheduler] invalid cron expression: ${config.schedulerCron} — not started`);
    return;
  }
  cron.schedule(config.schedulerCron, () => {
    console.log("[scheduler] nightly batch run starting");
    void runAllBatches();
  });
  console.log(`[scheduler] armed — nightly batches at "${config.schedulerCron}"`);
}
