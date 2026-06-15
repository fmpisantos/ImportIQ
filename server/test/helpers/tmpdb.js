// Import this FIRST in a test file (before any module that touches db.js) to
// point IMPORTIQ_DB at a throwaway SQLite file, so tests that read/write the
// config store never pollute the real server/data/importiq.db. db.js resolves
// its path at module-load time, and ESM evaluates imports in source order, so a
// leading `import './helpers/tmpdb.js'` runs this before db.js is evaluated.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.IMPORTIQ_DB = join(mkdtempSync(join(tmpdir(), 'importiq-test-')), 'test.db');
