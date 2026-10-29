import { sql, type Kysely } from 'kysely';

/**
 * Decision of AutoTalent Grid (29 Oct 2026): imported candidates can be found by employers straight away
 * (masked name, no contact details), unless they have turned it off themselves.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    WITH changed AS (
      UPDATE candidate_profiles cp SET searchable = true, updated_at = now()
      WHERE cp.source = 'import' AND cp.searchable = false
        AND NOT EXISTS (SELECT 1 FROM consent_events ce WHERE ce.user_id = cp.user_id AND ce.purpose = 'profile_searchable')
      RETURNING cp.user_id
    )
    INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, request_id, before, after, ip)
    SELECT gen_random_uuid(), NULL, 'candidate.import_made_searchable', 'user', NULL, NULL, NULL,
           jsonb_build_object('count', (SELECT count(*) FROM changed), 'reason', 'AutoTalent Grid decision of 29 Oct 2026'), NULL;
  `.execute(db);
}

export async function down(): Promise<void> {
  // Not reversed automatically: people may have changed the setting since.
}
