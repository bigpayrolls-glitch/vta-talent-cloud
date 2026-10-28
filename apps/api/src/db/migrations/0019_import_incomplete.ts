import { sql, type Kysely } from 'kysely';

/**
 * Bulk import of older lists (29 Oct 2026): a candidate may arrive without a city (users.date_of_birth was
 * already optional). They add it, with their date of birth, when they first sign in.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE candidate_profiles ALTER COLUMN city DROP NOT NULL`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`UPDATE candidate_profiles SET city = 'Unknown' WHERE city IS NULL; ALTER TABLE candidate_profiles ALTER COLUMN city SET NOT NULL`.execute(db);
}
