/**
 * Server entry point. Bootstraps the store, seeds default config, arms the
 * (opt-in) scheduler, and starts listening.
 */

import { config } from "./config.js";
import { createApp } from "./app.js";
import { startScheduler } from "./jobs/scheduler.js";
import { pruneCache } from "./store/cache.js";
import { seedCostConfig } from "./store/costConfig.js";

seedCostConfig();
pruneCache();

const app = createApp();
app.listen(config.port, () => {
  console.log(`ImportIQ server listening on http://localhost:${config.port}`);
  console.log(`  sources: ${config.sourceMode} (German) / ${config.ptSourceMode} (PT)`);
});

startScheduler();
