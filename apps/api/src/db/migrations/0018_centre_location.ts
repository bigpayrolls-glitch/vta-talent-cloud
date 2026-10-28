import { sql, type Kysely } from 'kysely';

/**
 * Centre location (28 Oct 2026): the GPS position (from the person's phone, with their permission) or a pasted
 * Google Maps link, so learners and staff can find the centre. Training partners may now add their own centres.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE centres
      ADD COLUMN latitude double precision CHECK (latitude BETWEEN -90 AND 90),
      ADD COLUMN longitude double precision CHECK (longitude BETWEEN -180 AND 180),
      ADD COLUMN map_url text,
      ADD COLUMN created_by uuid REFERENCES users(id),
      ADD CONSTRAINT centres_lat_lng_together CHECK ((latitude IS NULL) = (longitude IS NULL));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE centres DROP CONSTRAINT IF EXISTS centres_lat_lng_together, DROP COLUMN IF EXISTS latitude, DROP COLUMN IF EXISTS longitude, DROP COLUMN IF EXISTS map_url, DROP COLUMN IF EXISTS created_by`.execute(db);
}
