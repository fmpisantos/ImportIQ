// ImportIQ backend entry point.
import 'dotenv/config'; // load .env before anything reads process.env
import express from 'express';
import cors from 'cors';
import { getDb } from './db.js';
import { DATA_SOURCE } from './config.js';
import configRouter from './routes/config.js';
import searchRouter from './routes/search.js';
import exportRouter from './routes/export.js';

const PORT = process.env.PORT ?? 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/config', configRouter);
app.use('/api', searchRouter); // exposes /api/search and /api/brands
app.use('/api/export', exportRouter);

// Centralised error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Internal error' });
});

// Initialise the SQLite store (migrate + seed) before accepting traffic.
getDb();

app.listen(PORT, () => {
  console.log(`ImportIQ API listening on http://localhost:${PORT} (data source: ${DATA_SOURCE})`);
});
