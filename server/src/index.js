// ImportIQ backend entry point.
import 'dotenv/config'; // load .env before anything reads process.env
import express from 'express';
import cors from 'cors';
import { getDb } from './db.js';
import { getDataSource } from './config.js';
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

app.listen(PORT, () => {
  console.log(`ImportIQ API listening on http://localhost:${PORT}${BASE_PATH}/api (data source: ${getDataSource()})`);
});
