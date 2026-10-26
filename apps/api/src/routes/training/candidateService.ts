import type { FastifyRequest } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { z } from 'zod';
import type { candidateSchema } from '@vta/shared';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { Database } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';

type Executor = Kysely<Database> | Transaction<Database>;
export type CandidateInput = z.infer<typeof candidateSchema>;

/** VTA + two-digit year + five-digit sequence, e.g. VTA2600042. */
export async function nextCandidateCode(db: Executor): Promise<string> {
  const { rows } = await sql<{ n: string }>`select nextval('candidate_code_seq') as n`.execute(db);
  const yy = String(new Date().getUTCFullYear()).slice(-2);
  return `ATG${yy}${String(rows[0]!.n).padStart(5, '0')}`;
}

/**
 * SH-04: possible duplicate = another candidate with the same name (ignoring case and spacing)
 * and the same date of birth. Returns that candidate's user id, or null.
 */
export async function findPossibleDuplicate(db: Executor, name: string, dateOfBirth: string, excludeUserId?: string): Promise<string | null> {
  let q = db
    .selectFrom('users as u')
    .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
    .select('u.id')
    .where(sql`lower(regexp_replace(trim(u.name), '\\s+', ' ', 'g'))`, '=', name.trim().replace(/\s+/g, ' ').toLowerCase())
    .where('u.date_of_birth', '=', dateOfBirth)
    .where('u.status', '!=', 'deactivated')
    .orderBy('cp.created_at');
  if (excludeUserId) q = q.where('u.id', '!=', excludeUserId);
  return (await q.executeTakeFirst())?.id ?? null;
}

/**
 * Creates an invited candidate: user (phone sign-in), learner role, candidate profile.
 * Caller has already checked phone/email are free. Must run inside a transaction.
 */
export async function createCandidate(
  trx: Transaction<Database>,
  req: FastifyRequest,
  input: CandidateInput,
  source: 'admin' | 'import',
): Promise<{ id: string; code: string; duplicateOf: string | null }> {
  const id = newId();
  const code = await nextCandidateCode(trx);
  const duplicateOf = await findPossibleDuplicate(trx, input.name, input.dateOfBirth);
  await trx
    .insertInto('users')
    .values({ id, name: input.name, phone: input.phone, email: input.email ?? null, date_of_birth: input.dateOfBirth, status: 'invited' })
    .execute();
  await trx
    .insertInto('candidate_profiles')
    .values({
      user_id: id,
      candidate_code: code,
      city: input.city,
      state: input.state ?? null,
      skill_areas: input.skillAreas,
      experience_months: input.experienceMonths,
      education: input.education ?? null,
      languages: input.languages,
      verification_status: 'pending',
      duplicate_of: duplicateOf,
      source,
      created_by: req.actor?.userId ?? null,
    })
    .execute();
  await trx.insertInto('role_assignments').values({ id: newId(), user_id: id, role: 'learner', granted_by: req.actor?.userId ?? null }).execute();
  await audit(trx, auditCtx(req), {
    action: source === 'import' ? 'candidate.imported' : 'candidate.created',
    entityType: 'user',
    entityId: id,
    after: { candidate_code: code, name: input.name, city: input.city, duplicate_of: duplicateOf },
  });
  return { id, code, duplicateOf };
}
