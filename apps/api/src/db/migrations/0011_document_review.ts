import { sql, type Kysely } from 'kysely';

/** Phase 10 (AD-05): VTA verifies or rejects a candidate's document, with a reason when rejecting. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE documents
      ADD COLUMN reviewed_by uuid REFERENCES users(id),
      ADD COLUMN reviewed_at timestamptz,
      ADD COLUMN review_reason text;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE documents DROP COLUMN IF EXISTS reviewed_by, DROP COLUMN IF EXISTS reviewed_at, DROP COLUMN IF EXISTS review_reason;`.execute(db);
}
