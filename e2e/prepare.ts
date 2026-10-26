/**
 * Resets the browser-test database, applies migrations and loads the demo data.
 * Writes the generated demo passwords to .auth/credentials.json for the tests to use.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../apps/api/src/db/index.js';
import { migrateToLatest, resetDatabase } from '../apps/api/src/db/migrate.js';
import { seed } from '../apps/api/src/db/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.E2E_DATABASE_URL ?? 'postgres://vta:vta_dev@localhost:5432/vta_e2e';

const db = createDb(url);
try {
  await resetDatabase(db, 'test');
  await migrateToLatest(db, false);
  const { credentials, ids } = await seed(db);
  mkdirSync(path.join(here, '.auth'), { recursive: true });
  writeFileSync(path.join(here, '.auth/credentials.json'), JSON.stringify({ credentials, ids }, null, 2), { mode: 0o600 });
  rmSync(path.join(here, '.api.log'), { force: true });
  rmSync(path.join(here, '.storage'), { recursive: true, force: true });
  console.log(`Browser-test database ready (${credentials.length} demo users).`);
} finally {
  await db.destroy();
}
