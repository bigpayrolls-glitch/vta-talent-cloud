import { sql, type Kysely } from 'kysely';

/**
 * 29 Oct 2026: when a learner can join ("When can you join?" list, kept in candidate_profiles.availability)
 * and whether they would move for a job; the expected joining date an employer gives with an offer.
 * The actual joining date (job_applications.joining_date) is still recorded only once the person has started.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE candidate_profiles ADD COLUMN willing_to_relocate boolean`.execute(db);
  await sql`ALTER TABLE job_applications ADD COLUMN expected_joining_date date`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE job_applications DROP COLUMN IF EXISTS expected_joining_date`.execute(db);
  await sql`ALTER TABLE candidate_profiles DROP COLUMN IF EXISTS willing_to_relocate`.execute(db);
}
