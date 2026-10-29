import { sql, type Kysely } from 'kysely';

/**
 * 29 Oct 2026: accommodation with food. A course says whether stay with food is available and, once known,
 * its charge for the whole course (stay_fee_paise; null = to be confirmed). A learner who enrols says whether
 * they need it; the charge is added to what they pay when it is set.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE courses ADD COLUMN stay_available boolean NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE courses ADD COLUMN stay_fee_paise integer CHECK (stay_fee_paise >= 0)`.execute(db);
  await sql`ALTER TABLE enrolments ADD COLUMN needs_stay boolean NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE payment_orders ADD COLUMN needs_stay boolean NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE course_payments ADD COLUMN stay_paise integer NOT NULL DEFAULT 0`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE course_payments DROP COLUMN IF EXISTS stay_paise`.execute(db);
  await sql`ALTER TABLE payment_orders DROP COLUMN IF EXISTS needs_stay`.execute(db);
  await sql`ALTER TABLE enrolments DROP COLUMN IF EXISTS needs_stay`.execute(db);
  await sql`ALTER TABLE courses DROP COLUMN IF EXISTS stay_fee_paise`.execute(db);
  await sql`ALTER TABLE courses DROP COLUMN IF EXISTS stay_available`.execute(db);
}
