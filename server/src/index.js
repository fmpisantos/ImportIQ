// ImportIQ backend entry point.
import 'dotenv/config'; // load .env before anything reads process.env
import express from 'express';
import cors from 'cors';
import { getDb } from './db.js';
import { getDataSource, getIsvTablesConfig } from './config.js';
import configRouter from './routes/config.js';
import settingsRouter from './routes/settings.js';
import searchRouter from './routes/search.js';
import exportRouter from './routes/export.js';

const PORT = process.env.PORT ?? 3001;
// Routes are mounted under a base path so the app sits behind the Caddy reverse
// proxy in ../routing at /importiq/api/* (the proxy forwards the full path). Set
// BASE_PATH='' to serve the API at the root /api/* instead.
const BASE_PATH = (process.env.BASE_PATH ?? '/importiq').replace(/\/$/, '');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get(`${BASE_PATH}/api/health`, (req, res) => res.json({ ok: true }));
app.use(`${BASE_PATH}/api/config`, configRouter);
app.use(`${BASE_PATH}/api/settings`, settingsRouter);
app.use(`${BASE_PATH}/api`, searchRouter); // exposes /api/search and /api/brands
app.use(`${BASE_PATH}/api/export`, exportRouter);

// Centralised error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Internal error' });
});

// Initialise the SQLite store (migrate + seed) before accepting traffic.
getDb();

// In-process deal-ingestion scheduler: a run kicks off at startup (to populate /
// refresh the store immediately) and then once a day at 03:00 local time. Each
// run is awaited to completion before another can begin, so the startup run and
// the 03:00 run never overlap; a failure is logged, not fatal.
function startIngestScheduler() {
  let running = false;
  const runOnce = async (trigger) => {
    if (running) return; // never overlap passes
    running = true;
    try {
      const { runIngest } = await import('./jobs/ingestDeals.js');
      console.log(`[ingest] starting scheduled run (${trigger})`);
      await runIngest();
    } catch (err) {
      console.error('[ingest] scheduled run failed:', err);
    } finally {
      running = false;
    }
  };

  // ms from now until the next 03:00 local (today's if still ahead, else tomorrow).
  const msUntilNext3am = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };

  // Recompute the delay after each run rather than using a fixed 24h interval, so
  // the run stays pinned to 03:00 across DST shifts. .unref() so this timer never
  // keeps the process alive on its own (the HTTP listener does that).
  const scheduleNext = () => {
    const delay = msUntilNext3am();
    console.log(`[ingest] next daily run in ~${(delay / 3.6e6).toFixed(1)}h (03:00 local)`);
    setTimeout(async () => {
      await runOnce('daily 03:00');
      scheduleNext();
    }, delay).unref();
  };

  runOnce('startup'); // fire-and-forget — don't block the server coming up
  scheduleNext();
}

// In-process refresh of the statutory ISV tables: a check runs at startup and
// then once per configured interval (~yearly). The job scrapes reference pages
// and only applies values that ≥2 sources agree on; otherwise the hardcoded
// baseline stands. Same non-overlap + log-not-fatal discipline as the ingest
// scheduler. Gated behind getIsvTablesConfig().enabled (env ENABLE_ISV_TABLE_REFRESH).
function startIsvTableRefresh() {
  let running = false;
  const runOnce = async (trigger) => {
    if (running) return;
    running = true;
    try {
      const { runRefreshIsvTables } = await import('./jobs/refreshIsvTables.js');
      console.log(`[isv-refresh] starting run (${trigger})`);
      await runRefreshIsvTables();
    } catch (err) {
      console.error('[isv-refresh] run failed:', err);
    } finally {
      running = false;
    }
  };

  const scheduleNext = () => {
    const { intervalMs } = getIsvTablesConfig();
    console.log(`[isv-refresh] next check in ~${(intervalMs / 8.64e7).toFixed(0)} day(s)`);
    setTimeout(async () => {
      await runOnce('interval');
      scheduleNext();
    }, intervalMs).unref();
  };

  runOnce('startup');
  scheduleNext();
}

// The scheduler (incl. its startup run) only runs when explicitly enabled, so a
// local `npm run dev` never kicks off an ingest pass on every boot. Set
// ENABLE_INGEST_SCHEDULER=true (or 1) in production to turn it on.
const SCHEDULER_ENABLED = /^(true|1)$/i.test(process.env.ENABLE_INGEST_SCHEDULER ?? '');

app.listen(PORT, () => {
  console.log(`ImportIQ API listening on http://localhost:${PORT}${BASE_PATH}/api (data source: ${getDataSource()})`);
  if (SCHEDULER_ENABLED) {
    startIngestScheduler();
  } else {
    console.log('[ingest] scheduler disabled (set ENABLE_INGEST_SCHEDULER=true to enable)');
  }
  if (getIsvTablesConfig().enabled) {
    startIsvTableRefresh();
  } else {
    console.log('[isv-refresh] disabled (set ENABLE_ISV_TABLE_REFRESH=true to enable)');
  }
});
