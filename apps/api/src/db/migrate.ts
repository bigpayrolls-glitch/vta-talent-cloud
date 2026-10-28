import { sql } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDb, type DB } from './index.js';
import * as m0001 from './migrations/0001_foundation.js';
import * as m0002 from './migrations/0002_training.js';
import * as m0003 from './migrations/0003_operations.js';
import * as m0004 from './migrations/0004_offline_sync.js';
import * as m0005 from './migrations/0005_learner.js';
import * as m0006 from './migrations/0006_hiring.js';
import * as m0007 from './migrations/0007_programmes.js';
import * as m0008 from './migrations/0008_file_store.js';
import * as m0009 from './migrations/0009_org_signup.js';
import * as m0010 from './migrations/0010_notifications.js';
import * as m0011 from './migrations/0011_document_review.js';
import * as m0012 from './migrations/0012_subscriptions.js';
import * as m0013 from './migrations/0013_course_enrolment.js';
import * as m0014 from './migrations/0014_five_logins.js';
import * as m0015 from './migrations/0015_sms_provider.js';
import * as m0016 from './migrations/0016_razorpay.js';
import * as m0018 from './migrations/0018_centre_location.js';
import * as m0017 from './migrations/0017_partner_courses.js';

/** Explicit list: add each new migration here in order. Works the same from source and from the bundled build. */
const MIGRATIONS: Record<string, Migration> = {
  '0001_foundation': m0001,
  '0002_training': m0002,
  '0003_operations': m0003,
  '0004_offline_sync': m0004,
  '0005_learner': m0005,
  '0006_hiring': m0006,
  '0007_programmes': m0007,
  '0008_file_store': m0008,
  '0009_org_signup': m0009,
  '0010_notifications': m0010,
  '0011_document_review': m0011,
  '0012_subscriptions': m0012,
  '0013_course_enrolment': m0013,
  '0014_five_logins': m0014,
  '0015_sms_provider': m0015,
  '0016_razorpay': m0016,
  '0017_partner_courses': m0017,
  '0018_centre_location': m0018,
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
