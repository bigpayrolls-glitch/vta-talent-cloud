import { NOTICE_VERSION, type ConsentPurpose, type registerSchema } from '@vta/shared';
import type { FastifyRequest } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { Database } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { findPossibleDuplicate, nextCandidateCode } from '../training/candidateService.js';

type Executor = Kysely<Database> | Transaction<Database>;

export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean;
  noticeVersion: string | null;
  at: Date;
  source: 'self' | 'staff' | 'migration';
}

/** The newest consent row for each purpose (the current state). */
export async function consentState(db: Executor, userId: string): Promise<Map<ConsentPurpose, ConsentState>> {
  const { rows } = await sql<{ purpose: ConsentPurpose; granted: boolean; notice_version: string | null; created_at: Date; source: ConsentState['source'] }>`
    select distinct on (purpose) purpose, granted, notice_version, created_at, source
    from consent_events where user_id = ${userId}
    order by purpose, created_at desc, id desc`.execute(db);
  return new Map(rows.map((r) => [r.purpose, { purpose: r.purpose, granted: r.granted, noticeVersion: r.notice_version, at: r.created_at, source: r.source }]));
}

/** True until the person has accepted the current version of both the privacy notice and the terms. */
export async function consentRequired(db: Executor, userId: string): Promise<boolean> {
  const s = await consentState(db, userId);
  return !(['privacy_notice', 'terms'] as const).every((p) => s.get(p)?.granted && s.get(p)?.noticeVersion === NOTICE_VERSION);
}

export async function recordConsent(
  trx: Executor,
  e: { userId: string; purpose: ConsentPurpose; granted: boolean; noticeVersion?: string | null; source: 'self' | 'staff'; recordedBy: string },
): Promise<void> {
  await trx
    .insertInto('consent_events')
    .values({ id: newId(), user_id: e.userId, purpose: e.purpose, granted: e.granted, notice_version: e.noticeVersion ?? null, source: e.source, recorded_by: e.recordedBy })
    .execute();
}

/**
 * EE-01: a learner registers themselves. Creates the account (already active: the phone was just proved),
 * the learner role, a candidate profile waiting for VTA verification, and the accepted notice and terms.
 * The phone is known to be free. Must run inside a transaction.
 */
export async function createSelfRegisteredCandidate(trx: Transaction<Database>, req: FastifyRequest, input: z.infer<typeof registerSchema>): Promise<string> {
  const id = newId();
  const code = await nextCandidateCode(trx);
  const duplicateOf = await findPossibleDuplicate(trx, input.name, input.dateOfBirth);
  const now = new Date();
  await trx
    .insertInto('users')
    .values({ id, name: input.name, phone: input.phone, email: null, date_of_birth: input.dateOfBirth, status: 'active', phone_verified_at: now })
    .execute();
  await trx
    .insertInto('candidate_profiles')
    .values({ user_id: id, candidate_code: code, city: input.city, experience_months: 0, skill_areas: [], languages: [], verification_status: 'pending', duplicate_of: duplicateOf, source: 'self', created_by: id })
    .execute();
  await trx.insertInto('role_assignments').values({ id: newId(), user_id: id, role: 'learner', granted_by: null }).execute();
  for (const purpose of ['privacy_notice', 'terms'] as const) {
    await recordConsent(trx, { userId: id, purpose, granted: true, noticeVersion: input.noticeVersion, source: 'self', recordedBy: id });
  }
  await audit(trx, { ...auditCtx(req), actorId: id }, {
    action: 'candidate.self_registered',
    entityType: 'user',
    entityId: id,
    after: { candidate_code: code, name: input.name, city: input.city, duplicate_of: duplicateOf, notice_version: input.noticeVersion },
  });
  return id;
}
