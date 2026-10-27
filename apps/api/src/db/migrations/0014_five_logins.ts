import { sql, type Kysely } from 'kysely';

/**
 * Five logins (decision of 27 Oct 2026): Admin, Employer, Learner, Trainer and Training Partner.
 * - Operations Admins and Centre Admins become Admins (with everything).
 * - Recruiters and Partner Viewers lose access: each employer and training partner has one login.
 *   A person left with no role is deactivated and signed out.
 * Every change is recorded in the audit log. The old values stay in the role type so history still reads.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Trainers who sign up themselves give their city and years of experience.
    ALTER TABLE trainer_profiles ADD COLUMN city text, ADD COLUMN experience_years integer CHECK (experience_years BETWEEN 0 AND 50), ADD COLUMN self_registered boolean NOT NULL DEFAULT false;

    WITH promote AS (
      SELECT DISTINCT user_id FROM role_assignments
      WHERE revoked_at IS NULL AND role IN ('ops_admin', 'centre_admin')
        AND user_id NOT IN (SELECT user_id FROM role_assignments WHERE revoked_at IS NULL AND role = 'super_admin')
    )
    INSERT INTO role_assignments (id, user_id, role)
    SELECT gen_random_uuid(), user_id, 'super_admin' FROM promote;

    INSERT INTO audit_events (id, action, entity_type, entity_id, before, after)
    SELECT gen_random_uuid(), 'role.consolidated', 'user', user_id, jsonb_build_object('role', role), jsonb_build_object('role', CASE WHEN role IN ('ops_admin', 'centre_admin') THEN 'super_admin' ELSE NULL END)
    FROM role_assignments
    WHERE revoked_at IS NULL AND role IN ('ops_admin', 'centre_admin', 'employer_recruiter', 'partner_viewer');

    UPDATE role_assignments SET revoked_at = now()
    WHERE revoked_at IS NULL AND role IN ('ops_admin', 'centre_admin', 'employer_recruiter', 'partner_viewer');

    WITH orphaned AS (
      SELECT u.id FROM users u
      WHERE u.status <> 'deactivated'
        AND EXISTS (SELECT 1 FROM role_assignments r WHERE r.user_id = u.id AND r.role IN ('employer_recruiter', 'partner_viewer'))
        AND NOT EXISTS (SELECT 1 FROM role_assignments r WHERE r.user_id = u.id AND r.revoked_at IS NULL)
    ), closed AS (
      UPDATE users SET status = 'deactivated', updated_at = now() WHERE id IN (SELECT id FROM orphaned) RETURNING id
    )
    UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM closed);
  `.execute(db);
}

export async function down(): Promise<void> {
  // Not reversible: the earlier roles are gone by decision. Restore from a backup if needed.
}
