/**
 * Runs during a hosted build (Vercel): applies migrations, then loads the demo data once if the database is empty.
 * Demo data is loaded only on staging (APP_ENV=staging). The generated demo passwords are printed to the build log,
 * which only the project's owners can read.
 */
import { sql } from 'kysely';
import { loadConfig } from '../config.js';
import { createDb } from './index.js';
import { migrateToLatest } from './migrate.js';
import { seed } from './seed.js';
import { createFirstAdmin } from './first-admin.js';
import { providersFor } from '../lib/providers.js';

const config = loadConfig();
// Migrations need a direct (not pooled) connection when one is available (Neon provides DATABASE_URL_UNPOOLED).
const db = createDb(process.env.DATABASE_URL_UNPOOLED || config.databaseUrl);
try {
  await migrateToLatest(db);
  console.log('Migrations applied.');
  if (config.APP_ENV === 'staging') {
    const { rows } = await sql<{ n: string }>`select count(*) as n from users`.execute(db);
    if (Number(rows[0]!.n) === 0) {
      const { credentials, ids } = await seed(db);
      console.log('\nDemo data loaded. Demo sign-ins (staging only):');
      for (const c of credentials) {
        console.log(`  ${c.role.padEnd(20)} ${c.name.padEnd(24)} ${c.login.padEnd(32)} ${c.password ?? (c.login.startsWith('+') ? '(phone: code shown on screen)' : '(awaiting approval)')}`);
      }
      console.log(`  Certificate check page: /verify/${ids.credentialRaviCode}\n`);
    } else {
      console.log('Database already has data; demo data not loaded again.');
    }
  } else if (config.APP_ENV === 'production') {
    const log = { error: console.error, warn: console.warn, info: console.log } as unknown as Parameters<typeof providersFor>[1];
    const { email } = providersFor(config, log);
    console.log(await createFirstAdmin(db, { email: process.env.FIRST_ADMIN_EMAIL, name: process.env.FIRST_ADMIN_NAME, origin: config.APP_ORIGIN, email_: email }));
  }
} finally {
  await db.destroy();
}
