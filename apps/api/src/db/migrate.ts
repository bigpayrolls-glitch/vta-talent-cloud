import { sql } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDb, type DB } from './index.js';
import * as m0001 from './migrations/0001_foundation.js';
import * as m0002 from './migrations/0002_training.js';
import * as m0003 from './migrations/0003_operations.js';

/** Explicit list: add each new migration here in order. Works the same from source and from the bundled build. */
const MIGRATIONS: Record<string, Migration> = {
  '0001_foundation': m0001,
  '0002_training': m0002,
  '0003_operations': m0003,
};

const provider: MigrationProvider = { getMigrations: async () => MIGRATIONS };

export async function migrateToLatest(db: DB, log = true): Promise<void> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (!log) continue;
    if (r.status === 'Success') console.log(`  applied ${r.migrationName}`);
    if (r.status === 'Error') console.error(`  failed ${r.migrationName}`);
  }
  if (error) throw error;
}

/** Drops everything. Refused in production. Used by `pnpm db:reset` and tests. */
export async function resetDatabase(db: DB, nodeEnv: string): Promise<void> {
  if (nodeEnv === 'production') throw new Error('Refusing to reset a production database.');
  await sql`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`.execute(db);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  try {
    if (process.argv.includes('--reset')) {
      await resetDatabase(db, config.NODE_ENV);
      console.log('Database reset.');
    }
    await migrateToLatest(db);
    console.log('Migrations complete.');
  } finally {
    await db.destroy();
  }
}
