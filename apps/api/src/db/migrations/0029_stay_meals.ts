import { sql, type Kysely } from 'kysely';

/** 29 Oct 2026: how many meals a day come with a course's accommodation (1 to 3; one meal a day unless set). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE courses ADD COLUMN stay_meals integer NOT NULL DEFAULT 1 CHECK (stay_meals BETWEEN 1 AND 3)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE courses DROP COLUMN IF EXISTS stay_meals`.execute(db);
}
