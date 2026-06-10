// Export API (PLAN.md §8).
//   POST /api/export/csv   → one row per result
//   POST /api/export/json  → full structured data (incl. ISV breakdown)
//
// The frontend POSTs the already-computed results array back so the export
// reflects exactly what the user sees (including inline config edits).

import { Router } from 'express';

const router = Router();

const CSV_COLUMNS = [
  'brand',
  'model',
  'year',
  'mileageKm',
  'fuelType',
  'germanPriceEur',
  'isvEur',
  'transportEur',
  'legalisationEur',
  'totalLandedEur',
  'ptMarketAvgEur',
  'savingEur',
];

function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function resultToRow(r) {
  const b = r.breakdown ?? {};
  return {
    brand: r.listing?.brand,
    model: r.listing?.model,
    year: r.listing?.year,
    mileageKm: r.listing?.mileageKm,
    fuelType: r.listing?.fuelType,
    germanPriceEur: b.germanPriceEur,
    isvEur: b.isv?.isv,
    transportEur: b.transport?.amountEur,
    legalisationEur: b.legalisation?.totalEur,
    totalLandedEur: r.totalLandedCostEur,
    ptMarketAvgEur: r.comparison?.avgPriceEur,
    savingEur: r.savingEur,
  };
}

router.post('/csv', (req, res) => {
  const results = req.body?.results ?? [];
  const header = CSV_COLUMNS.join(',');
  const lines = results.map((r) => {
    const row = resultToRow(r);
    return CSV_COLUMNS.map((c) => csvCell(row[c])).join(',');
  });
  const csv = [header, ...lines].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="importiq-results.csv"');
  res.send(csv);
});

router.post('/json', (req, res) => {
  const results = req.body?.results ?? [];
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="importiq-results.json"');
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), results }, null, 2));
});

export default router;
