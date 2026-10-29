import { sql, type Kysely } from 'kysely';
import { PLAN_INFO } from '@vta/shared';

/**
 * 29 Oct 2026: plan details (names, prices, limits and feature lines) are kept in the database so AutoTalent
 * Grid can change them from Admin > Plans. The plan codes stay fixed; everything about each plan can be edited.
 * Starts from the plans the site had until now.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE plan_catalogue (
      audience text NOT NULL CHECK (audience IN ('employer', 'partner')),
      code text NOT NULL,
      info jsonb NOT NULL,
      updated_by uuid REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (audience, code)
    )
  `.execute(db);
  for (const [code, info] of Object.entries(PLAN_INFO)) {
    await sql`INSERT INTO plan_catalogue (audience, code, info) VALUES ('employer', ${code}, ${JSON.stringify(info)}::jsonb) ON CONFLICT DO NOTHING`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS plan_catalogue`.execute(db);
}
