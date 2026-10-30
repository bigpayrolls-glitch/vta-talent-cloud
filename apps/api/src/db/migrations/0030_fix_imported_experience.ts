import { sql, type Kysely } from 'kysely';

/**
 * 30 Oct 2026, at AutoTalent Grid's request: the candidate import read numbers in the source sheets as years.
 * AutoTalent Grid confirmed that figures above 10 years were really months, so for imported candidates an
 * experience over 120 months becomes that number of months (420 months, shown as 35 years, becomes 35 months).
 * A candidate who changed their own experience, or whose profile staff edited, is left alone. Each change is in
 * the audit log.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const rows = await sql<{ user_id: string; experience_months: number }>`
    SELECT cp.user_id, cp.experience_months
    FROM candidate_profiles cp
    WHERE cp.source = 'import'
      AND cp.experience_months > 120
      AND NOT EXISTS (
        SELECT 1 FROM audit_events a
        WHERE a.entity_id = cp.user_id
          AND a.action IN ('candidate.self_updated', 'candidate.updated')
          AND a.after ? 'experience_months'
      )
  `.execute(db);
  for (const r of rows.rows) {
    const months = Math.round(r.experience_months / 12);
    await sql`UPDATE candidate_profiles SET experience_months = ${months}, updated_at = now() WHERE user_id = ${r.user_id}`.execute(db);
    await sql`
      INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, request_id, before, after)
      VALUES (gen_random_uuid(), NULL, 'candidate.experience_corrected', 'user', ${r.user_id}, 'migration-0030',
        ${JSON.stringify({ experience_months: r.experience_months })}::jsonb,
        ${JSON.stringify({ experience_months: months, reason: 'Imported figure was months, not years' })}::jsonb)
    `.execute(db);
  }
}

export async function down(): Promise<void> {
  // Not undone automatically: the audit log keeps every value before the correction.
}
