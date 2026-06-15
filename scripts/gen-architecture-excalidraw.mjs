// Generates ImportIQ-architecture.excalidraw — a clean, orthogonally-routed
// diagram of the whole project. Run: node scripts/gen-architecture-excalidraw.mjs
//
// Layout principles (to avoid "lines over boxes"):
//  - Top-down read path on the left/centre; shared Store + Config on a right rail.
//  - Ingestion pipeline (dispatcher → adapters → engine) fed by Jobs.
//  - Every cross-zone arrow is orthogonal (elbow) and routed through an EMPTY
//    gutter lane; intra-zone fan-outs stay short and never cross a box.
import { writeFileSync } from 'node:fs';

let _seed = 1;
const rnd = () => Math.floor(Math.abs(Math.sin(_seed++)) * 2147483647) >>> 0;

const COLORS = {
  frontend: { bg: '#e7f5ff', stroke: '#1971c2' },
  api: { bg: '#fff9db', stroke: '#f08c00' },
  routes: { bg: '#fff3bf', stroke: '#e8590c' },
  seam: { bg: '#ffe3e3', stroke: '#e03131' },
  adapter: { bg: '#f3f0ff', stroke: '#7048e8' },
  engine: { bg: '#ebfbee', stroke: '#2f9e44' },
  config: { bg: '#e3fafc', stroke: '#0c8599' },
  db: { bg: '#fff0f6', stroke: '#c2255c' },
  jobs: { bg: '#f1f3f5', stroke: '#495057' },
  zone: { stroke: '#adb5bd' },
};

const elements = [];
const nodes = {}; // id -> {x,y,w,h}

const base = (extra) => ({
  angle: 0, fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
  roughness: 0, opacity: 100, groupIds: [], frameId: null,
  roundness: { type: 3 }, seed: rnd(), version: 1, versionNonce: rnd(),
  isDeleted: false, boundElements: [], updated: 1, link: null, locked: false,
  ...extra,
});

function textEl(extra) {
  return {
    type: 'text', angle: 0, backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: rnd(), version: 1,
    versionNonce: rnd(), isDeleted: false, boundElements: [], updated: 1,
    link: null, locked: false, fontFamily: 2, textAlign: 'center',
    verticalAlign: 'middle', lineHeight: 1.25, ...extra,
  };
}

// Dashed zone container with a top-left label.
function zone(id, x, y, w, h, label, colorKey) {
  const c = COLORS[colorKey] ?? COLORS.zone;
  elements.push(base({
    id, type: 'rectangle', x, y, width: w, height: h,
    strokeColor: c.stroke, backgroundColor: 'transparent',
    fillStyle: 'solid', strokeStyle: 'dashed', strokeWidth: 1.5,
    roundness: { type: 3 },
  }));
  elements.push(textEl({
    id: id + '-label', x: x + 14, y: y + 10, width: w - 28, height: 20,
    strokeColor: c.stroke, text: label, fontSize: 15, fontFamily: 2,
    textAlign: 'left', verticalAlign: 'top', containerId: null,
    originalText: label, baseline: 15,
  }));
}

// Solid node with centred bound text (title + optional multi-line desc).
function node(id, x, y, w, h, title, desc, colorKey) {
  const c = COLORS[colorKey];
  const tid = id + '-text';
  nodes[id] = { x, y, w, h };
  elements.push(base({
    id, type: 'rectangle', x, y, width: w, height: h,
    strokeColor: c.stroke, backgroundColor: c.bg,
    boundElements: [{ type: 'text', id: tid }], roundness: { type: 3 },
  }));
  const text = desc ? `${title}\n${desc}` : title;
  const fontSize = 13;
  const th = text.split('\n').length * fontSize * 1.25;
  elements.push(textEl({
    id: tid, x: x + 6, y: y + (h - th) / 2, width: w - 12, height: th,
    strokeColor: c.stroke, text, fontSize, containerId: id,
    originalText: text, baseline: th - 3,
  }));
}

const anchor = (id, side) => {
  const n = nodes[id];
  if (side === 'top') return { x: n.x + n.w / 2, y: n.y };
  if (side === 'bottom') return { x: n.x + n.w / 2, y: n.y + n.h };
  if (side === 'left') return { x: n.x, y: n.y + n.h / 2 };
  return { x: n.x + n.w, y: n.y + n.h / 2 }; // right
};

// Straight arrow between two box sides (for short, non-crossing links).
function arrow(fromId, fromSide, toId, toSide, opts = {}) {
  const s = anchor(fromId, fromSide), e = anchor(toId, toSide);
  pushArrow([[s.x, s.y], [e.x, e.y]], { ...opts, startId: fromId, endId: toId });
}

// Orthogonal arrow following explicit absolute waypoints (elbow routing).
function ortho(pts, opts = {}) {
  pushArrow(pts, opts);
}

function pushArrow(abs, opts = {}) {
  const x0 = abs[0][0], y0 = abs[0][1];
  const id = `arr-${rnd()}`;
  const last = abs[abs.length - 1];
  const arrowEl = base({
    id, type: 'arrow',
    x: x0, y: y0,
    width: Math.abs(last[0] - x0), height: Math.abs(last[1] - y0),
    strokeColor: opts.color ?? '#495057',
    backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: opts.bold ? 2.5 : 1.5,
    strokeStyle: opts.dashed ? 'dashed' : 'solid',
    roundness: { type: 2 },
    points: abs.map(([x, y]) => [x - x0, y - y0]),
    lastCommittedPoint: null,
    startBinding: opts.startId ? { elementId: opts.startId, focus: 0, gap: 2 } : null,
    endBinding: opts.endId ? { elementId: opts.endId, focus: 0, gap: 2 } : null,
    startArrowhead: null, endArrowhead: 'arrow',
  });
  if (opts.label) {
    const tid = id + '-lbl';
    arrowEl.boundElements = [{ type: 'text', id: tid }];
    // mid of the longest segment as a placement hint (Excalidraw recentres)
    let mx = (x0 + last[0]) / 2, my = (y0 + last[1]) / 2;
    elements.push(textEl({
      id: tid, x: mx - 30, y: my - 8, width: 60, height: 16,
      strokeColor: opts.color ?? '#495057', backgroundColor: '#ffffff',
      fillStyle: 'solid', text: opts.label, fontSize: 11, fontFamily: 2,
      containerId: id, originalText: opts.label, baseline: 12,
    }));
  }
  elements.push(arrowEl);
}

// ─────────────────────────────── LAYOUT ───────────────────────────────
// Main column: x 40–940 (read path + pipeline).  Right rail: x 1240–1680.

// 1 — FRONTEND
zone('z-front', 40, 40, 1140, 220,
  'FRONTEND — web/   ·   App.jsx = React Router (Search · Config · Settings pages)', 'frontend');
node('p-search', 100, 110, 300, 60, 'SearchPage.jsx', 'FilterForm · ResultCard', 'frontend');
node('p-config', 460, 110, 300, 60, 'ConfigPage.jsx', 'cost_config editor', 'frontend');
node('p-settings', 820, 110, 300, 60, 'SettingsPage.jsx', 'runtime.* + DATA_SOURCE', 'frontend');
node('apijs', 500, 185, 300, 55, 'api.js', 'REST client → /api/*', 'frontend');

// 2 — EXPRESS
zone('z-api', 40, 300, 1140, 130, 'API SERVER — server/src/index.js (Express, BASE_PATH/api)', 'api');
node('index', 480, 360, 340, 60, 'index.js', 'Express · CORS · mounts routers', 'api');
node('sched', 880, 360, 280, 60, 'Schedulers', 'in-process · env-gated', 'api');

// 3 — ROUTES  (order L→R puts the config-writing route nearest the right rail)
zone('z-routes', 40, 490, 1140, 120, 'ROUTES — server/src/routes/   (config & settings routes persist to the store)', 'routes');
node('r-search', 100, 545, 300, 60, 'search.js', 'default: read store · ?live → pipeline', 'routes');
node('r-export', 440, 545, 180, 60, 'export.js', '/export (CSV)', 'routes');
node('r-settings', 660, 545, 240, 60, 'settings.js', '/settings', 'routes');
node('r-config', 940, 545, 200, 60, 'config.js', '/config', 'routes');

// 4 — DISPATCHER + ADAPTERS (the key seam)
zone('z-disp', 40, 670, 900, 470,
  'DATA-SOURCE DISPATCHER — adapters/source.js   ★ the single seam (switch on DATA_SOURCE)', 'seam');
node('disp', 80, 730, 820, 55, 'source.js', 'rest of app is source-agnostic', 'seam');
node('m-mock', 80, 820, 190, 70, 'mock', 'deterministic samples', 'adapter');
node('m-direct', 290, 820, 190, 70, 'direct  ★', 'keyless scraping', 'adapter');
node('m-official', 500, 820, 190, 70, 'official', 'mobile.de API', 'adapter');
node('m-apify', 710, 820, 190, 70, 'apify', 'paid actors', 'adapter');
node('s-direct', 290, 925, 190, 110, 'directSearch.js', 'direct/autoscout24\nptComparison\n(olx + standvirtual)', 'adapter');
node('s-official', 500, 925, 190, 110, 'mobilede.js', 'mobiledeClient\nmobiledeMap', 'adapter');
node('s-apify', 710, 925, 190, 110, 'apifySearch.js', 'sites/{mobilede,\nautoscout24,\nautouncle}', 'adapter');
node('normalize', 80, 1065, 400, 55, 'normalize.js', 'shared cleaners → one listing shape', 'adapter');
node('ptmarket', 500, 1065, 400, 55, 'ptmarket.js', 'getComparison() → PT market value', 'adapter');

// 5 — ENGINE
zone('z-engine', 40, 1180, 900, 290, 'ENGINE — server/src/engine/   (pure & deterministic)', 'engine');
node('landed', 80, 1240, 820, 65, 'landedCost.js — composer',
  'German + ISV + VAT* + Transport + Legalisation → attachComparison', 'engine');
node('isv', 80, 1335, 200, 90, 'isv.js', 'isvTables\nisvTableStore', 'engine');
node('vat', 300, 1335, 190, 90, 'vat.js', '23% IVA*\n(new transport)', 'engine');
node('iuc', 510, 1335, 180, 90, 'iuc.js', 'annual,\nseparate', 'engine');
node('sanity', 710, 1335, 190, 90, 'priceSanity.js', 'low-price\nflag', 'engine');

// Right rail — CONFIG
zone('z-config', 1240, 490, 440, 120, 'CONFIG — config.js', 'config');
node('config', 1280, 545, 360, 60, 'config.js — resolution',
  'Settings UI → .env → default  (per request)', 'config');

// Right rail — STORE
zone('z-db', 1240, 670, 440, 470, 'STORE — SQLite (db.js, better-sqlite3)', 'db');
node('db', 1280, 760, 360, 290, 'importiq.db',
  'deals  (precomputed results)\n\ncost_config · active_settings\n\ncaches:\npt_market · refdata · listings', 'db');

// Right rail — JOBS
zone('z-jobs', 1240, 1180, 440, 290,
  'JOBS — server/src/jobs/   (all write the store)', 'jobs');
node('j-ingest', 1280, 1240, 360, 60, 'ingestDeals.js', 'daily batch · fetch → cost → upsert', 'jobs');
node('j-recompute', 1280, 1320, 360, 55, 'recomputeDeals.js', 'maintenance recost', 'jobs');
node('j-isv', 1280, 1395, 360, 55, 'refreshIsvTables.js', 'yearly ISV refresh (≥2 sources)', 'jobs');

// ─────────────────────────────── ARROWS ───────────────────────────────
// Frontend internal (short fan-in)
arrow('p-search', 'bottom', 'apijs', 'top');
arrow('p-config', 'bottom', 'apijs', 'top');
arrow('p-settings', 'bottom', 'apijs', 'top');
// Entry
arrow('apijs', 'bottom', 'index', 'top');
// index → routes (fan-out, gutter only)
arrow('index', 'bottom', 'r-search', 'top');
arrow('index', 'bottom', 'r-export', 'top');
arrow('index', 'bottom', 'r-settings', 'top');
arrow('index', 'bottom', 'r-config', 'top');
// Dispatcher → modes (fan), modes → subs, subs → normalize
arrow('disp', 'bottom', 'm-mock', 'top');
arrow('disp', 'bottom', 'm-direct', 'top');
arrow('disp', 'bottom', 'm-official', 'top');
arrow('disp', 'bottom', 'm-apify', 'top');
arrow('m-direct', 'bottom', 's-direct', 'top');
arrow('m-official', 'bottom', 's-official', 'top');
arrow('m-apify', 'bottom', 's-apify', 'top');
arrow('s-direct', 'bottom', 'normalize', 'top');
arrow('s-official', 'bottom', 'normalize', 'top');
arrow('s-apify', 'bottom', 'normalize', 'top');
// Adapters → engine
arrow('normalize', 'bottom', 'landed', 'top');
arrow('ptmarket', 'bottom', 'landed', 'top');
// Engine fan-out
arrow('landed', 'bottom', 'isv', 'top');
arrow('landed', 'bottom', 'vat', 'top');
arrow('landed', 'bottom', 'iuc', 'top');
arrow('landed', 'bottom', 'sanity', 'top');

// Cross-zone, orthogonal, each in its own empty gutter lane:
// search.js → store  (primary read path)
ortho([[250, 605], [250, 638], [1100, 638], [1100, 715], [1240, 715]],
  { startId: 'r-search', endId: 'db', bold: true, color: '#c2255c', label: 'read deals' });
// scheduler → ingestDeals  (lane x1200, between routes zone and right rail)
ortho([[1160, 390], [1200, 390], [1200, 1258], [1280, 1258]],
  { startId: 'sched', endId: 'j-ingest', dashed: true, color: '#f08c00', label: 'schedule' });
// ingestDeals → source.js  (lane x960, central gutter)
ortho([[1280, 1282], [960, 1282], [960, 757], [900, 757]],
  { startId: 'j-ingest', endId: 'disp', color: '#495057', label: 'fetch' });
// ingestDeals → store  (short vertical, right rail)
ortho([[1380, 1240], [1380, 1140]],
  { startId: 'j-ingest', endId: 'db', color: '#c2255c', label: 'upsert' });
// config resolver → dispatcher  (DATA_SOURCE), lane y652
ortho([[1340, 605], [1340, 652], [490, 652], [490, 730]],
  { startId: 'config', endId: 'disp', dashed: true, color: '#0c8599', label: 'DATA_SOURCE' });
// config resolver → store  (reads active_settings)
ortho([[1500, 605], [1500, 670]],
  { startId: 'config', endId: 'db', dashed: true, color: '#0c8599', label: 'settings' });

const doc = {
  type: 'excalidraw', version: 2, source: 'https://excalidraw.com',
  elements,
  appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
  files: {},
};
writeFileSync('ImportIQ-architecture.excalidraw', JSON.stringify(doc, null, 2));
console.log(`Wrote ImportIQ-architecture.excalidraw — ${elements.length} elements`);
