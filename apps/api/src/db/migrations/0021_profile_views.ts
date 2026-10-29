import { sql, type Kysely } from 'kysely';

/**
 * Candidate search limits by plan (29 Oct 2026): each full profile an employer opens counts once per calendar
 * month (India time). One row per employer, candidate and month.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE candidate_profile_views (
      organisation_id uuid NOT NULL REFERENCES organisations(id),
      candidate_id uuid NOT NULL REFERENCES users(id),
      period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
      viewed_by uuid NOT NULL REFERENCES users(id),
      first_viewed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organisation_id, period, candidate_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS candidate_profile_views`.execute(db);
}
