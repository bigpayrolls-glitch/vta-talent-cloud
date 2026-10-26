import { sql, type Kysely } from 'kysely';

/** Phase 8: organisations can register themselves. Records how each one was added (VTA or self-registration). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE organisations
      ADD COLUMN registration_source text NOT NULL DEFAULT 'vta' CHECK (registration_source IN ('vta', 'self'));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE organisations DROP COLUMN IF EXISTS registration_source;`.execute(db);
}
