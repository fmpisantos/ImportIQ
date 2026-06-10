// Configuration API (PLAN.md §4.6).
//   GET  /api/config         → all cost-config rows + active settings
//   PUT  /api/config/:key    → update a single row (amount / enabled / notes)
//   POST /api/config/active  → set the active transport method

import { Router } from 'express';
import {
  getAllCostConfig,
  getActiveSettings,
  updateCostConfig,
  setActiveSetting,
} from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    costConfig: getAllCostConfig(),
    activeSettings: getActiveSettings(),
  });
});

router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { amount_eur, enabled, notes } = req.body ?? {};

  if (amount_eur !== undefined && (typeof amount_eur !== 'number' || amount_eur < 0)) {
    return res.status(400).json({ error: 'amount_eur must be a non-negative number' });
  }

  const updated = updateCostConfig(
    key,
    { amount_eur, enabled, notes },
    new Date().toISOString()
  );
  if (!updated) return res.status(404).json({ error: `Unknown config key: ${key}` });
  res.json(updated);
});

router.post('/active', (req, res) => {
  const { method } = req.body ?? {};
  if (!method || typeof method !== 'string') {
    return res.status(400).json({ error: 'method (config key) is required' });
  }
  const row = getAllCostConfig().find((r) => r.key === method);
  if (!row || row.category !== 'transport') {
    return res.status(400).json({ error: `${method} is not a transport method` });
  }
  setActiveSetting('transport.active_method', method);
  res.json({ 'transport.active_method': method });
});

export default router;
