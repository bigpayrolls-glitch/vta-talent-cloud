import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';

/**
 * 29 Oct 2026, at AutoTalent Grid's request: candidates were added by mistake to VOC's batch
 * "Jr Technician – Beginner Certification | Bengaluru | November 2026" on 29 Oct. They are withdrawn here.
 * Only enrolments added that day through "Enrol candidates" (not self-enrolled or paid), with no attendance or
 * assessment yet, in a batch that has not started. Each withdrawal is written to the audit log.
 * Nothing happens if the batch is not there (other databases) or if the numbers look wrong.
 */
const REASON = 'Added by mistake. Removed at AutoTalent Grid’s request on 29 Oct 2026.';

export async function up(db: Kysely<unknown>): Promise<void> {
  const batches = await sql<{ id: string }>`
    SELECT b.id FROM batches b
    WHERE b.name ILIKE 'Jr Technician%Beginner Certification%Bengaluru%November 2026' AND b.status = 'planned'
  `.execute(db);
  if (batches.rows.length !== 1) return;
  const batchId = batches.rows[0]!.id;
  const rows = await sql<{ id: string; candidate_id: string }>`
    SELECT e.id, e.candidate_id FROM enrolments e
    WHERE e.batch_id = ${batchId}
      AND e.status = 'enrolled'
      AND e.source = 'centre'
      AND (e.enrolled_at AT TIME ZONE 'Asia/Kolkata')::date = DATE '2026-10-29'
      AND NOT EXISTS (SELECT 1 FROM attendance_records a JOIN attendance_sessions s ON s.id = a.session_id WHERE s.batch_id = e.batch_id AND a.candidate_id = e.candidate_id)
      AND NOT EXISTS (SELECT 1 FROM assessment_results r WHERE r.enrolment_id = e.id)
  `.execute(db);
  if (rows.rows.length === 0 || rows.rows.length > 20) return;
  for (const r of rows.rows) {
    await sql`UPDATE enrolments SET status = 'withdrawn', withdrawn_at = now(), withdraw_reason = ${REASON}, updated_at = now() WHERE id = ${r.id}`.execute(db);
    await sql`
      INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, request_id, before, after)
      VALUES (${randomUUID()}, NULL, 'enrolment.withdrawn', 'batch', ${batchId}, 'migration-0028',
        ${JSON.stringify({ candidateId: r.candidate_id, status: 'enrolled' })}::jsonb,
        ${JSON.stringify({ candidateId: r.candidate_id, status: 'withdrawn', reason: REASON })}::jsonb)
    `.execute(db);
  }
}

export async function down(): Promise<void> {
  // A withdrawal is not undone automatically; enrol the candidates again from the batch if needed.
}
