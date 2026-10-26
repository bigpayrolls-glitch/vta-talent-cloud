import { sql, type Kysely } from 'kysely';

/**
 * Staging on hosts without a persistent disk (Vercel): uploaded files can be kept in PostgreSQL
 * (STORAGE_DRIVER=database). The table stays empty with the local-disk driver.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE stored_files (
      key text PRIMARY KEY,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS stored_files;`.execute(db);
}
