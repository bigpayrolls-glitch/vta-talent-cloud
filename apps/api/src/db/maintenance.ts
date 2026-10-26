/**
 * Phase 10: routine clean-up. Run it once a day (see docs/operations.md):
 *
 *   pnpm --filter @vta/api maintenance
 *
 * - Deletes sign-in codes, sessions and password-reset links that ended long ago (they hold only hashes,
 *   and nothing else refers to them).
 * - Closes organisation sign-ups whose email was never confirmed within 30 days: the organisation is marked
 *   rejected with a reason and the unused account deactivated. Nothing is erased (audit trail kept).
 * Each run writes one audit event with the counts. Safe to run more than once.
 */
import { sql } from 'kysely';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../audit/service.js';
import { loadConfig } from '../config.js';
import { createDb, type DB } from './index.js';

export const UNCONFIRMED_SIGNUP_DAYS = 30;
const DAY = 86_400_000;

export interface MaintenanceResult {
  otpChallengesDeleted: number;
  sessionsDeleted: number;
  passwordResetsDeleted: number;
  signupsClosed: number;
}

export async function runMaintenance(db: DB, now = new Date()): Promise<MaintenanceResult> {
  return db.transaction().execute(async (trx) => {
    const otp = await trx.deleteFrom('otp_challenges').where('created_at', '<', new Date(now.getTime() - DAY)).executeTakeFirst();
    const sessions = await trx
      .deleteFrom('sessions')
      .where((eb) => eb.or([eb('expires_at', '<', new Date(now.getTime() - 30 * DAY)), eb('revoked_at', '<', new Date(now.getTime() - 30 * DAY))]))
      .executeTakeFirst();
    const resets = await trx.deleteFrom('password_resets').where('created_at', '<', new Date(now.getTime() - 7 * DAY)).executeTakeFirst();

    // Self-registered organisations whose only admin never confirmed their email.
    const stale = await trx
      .selectFrom('organisations as o')
      .innerJoin('role_assignments as ra', 'ra.organisation_id', 'o.id')
      .innerJoin('users as u', 'u.id', 'ra.user_id')
      .select(['o.id as org_id', 'u.id as user_id'])
      .where('o.registration_source', '=', 'self')
      .where('o.verification_status', '=', 'pending')
      .where('o.submitted_at', 'is', null)
      .where('o.created_at', '<', new Date(now.getTime() - UNCONFIRMED_SIGNUP_DAYS * DAY))
      .where('u.status', '=', 'invited')
      .where('ra.revoked_at', 'is', null)
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('role_assignments as other').innerJoin('users as ou', 'ou.id', 'other.user_id').select(sql`1`.as('x')).whereRef('other.organisation_id', '=', 'o.id').where('ou.status', '=', 'active'))),
      )
      .execute();
    const reason = `Email not confirmed within ${UNCONFIRMED_SIGNUP_DAYS} days. Register again to continue.`;
    for (const s of stale) {
      await trx.updateTable('organisations').set({ verification_status: 'rejected', verification_reason: reason, status: 'inactive', updated_at: now }).where('id', '=', s.org_id).execute();
      await trx.updateTable('users').set({ status: 'deactivated', updated_at: now }).where('id', '=', s.user_id).execute();
      await trx.updateTable('invitations').set({ expires_at: now }).where('user_id', '=', s.user_id).where('accepted_at', 'is', null).execute();
      await audit(trx, { actorId: null, requestId: null, ip: null }, { action: 'organisation.signup_expired', entityType: 'organisation', entityId: s.org_id, after: { userId: s.user_id, reason } });
    }

    const result = {
      otpChallengesDeleted: Number(otp.numDeletedRows),
      sessionsDeleted: Number(sessions.numDeletedRows),
      passwordResetsDeleted: Number(resets.numDeletedRows),
      signupsClosed: stale.length,
    };
    await audit(trx, { actorId: null, requestId: null, ip: null }, { action: 'maintenance.run', entityType: 'system', entityId: null, after: { ...result } });
    return result;
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  const db = createDb(process.env.DATABASE_URL_UNPOOLED || config.databaseUrl, 1);
  try {
    console.log(JSON.stringify({ maintenance: await runMaintenance(db) }));
  } finally {
    await db.destroy();
  }
}
