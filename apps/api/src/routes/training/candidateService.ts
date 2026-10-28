import type { FastifyRequest } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { z } from 'zod';
import type { CandidateImportInput, candidateSchema } from '@vta/shared';
import { auditCtx } from '../../app.js';
import { audit, auditMany } from '../../audit/service.js';
import type { Database } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';

type Executor = Kysely<Database> | Transaction<Database>;
export type CandidateInput = z.infer<typeof candidateSchema>;

const chunks = <T>(list: T[], size: number): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

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

/**
 * Creates many invited candidates at once (CSV import), in a handful of database calls whatever their number:
 * candidate codes, users, profiles, learner roles and audit records are each written in one go.
 * `duplicates` holds, per input, whether the import check found an existing candidate with the same name and
 * date of birth; that candidate is looked up here so the profile can point to it. Must run inside a transaction.
 */
export async function createCandidates(trx: Transaction<Database>, req: FastifyRequest, inputs: CandidateImportInput[], source: 'import'): Promise<{ id: string; code: string }[]> {
  if (!inputs.length) return [];
  const { rows: seq } = await sql<{ n: string }>`select nextval('candidate_code_seq') as n from generate_series(1, ${inputs.length})`.execute(trx);
  const yy = String(new Date().getUTCFullYear()).slice(-2);
  const norm = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();
  // Existing candidates with the same date of birth: the possible duplicates among them, oldest first.
  const dobs = [...new Set(inputs.flatMap((i) => (i.dateOfBirth ? [i.dateOfBirth] : [])))];
  const existing = !dobs.length ? [] : await trx
    .selectFrom('users as u')
    .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
    .select(['u.id', 'u.name', 'u.date_of_birth'])
    .where('u.date_of_birth', 'in', dobs)
    .where('u.status', '!=', 'deactivated')
    .orderBy('cp.created_at')
    .execute();
  const firstMatch = new Map<string, string>();
  for (const e of existing) {
    const k = `${norm(e.name)}|${e.date_of_birth}`;
    if (!firstMatch.has(k)) firstMatch.set(k, e.id);
  }
  // In file order, so a second row with the same name and date of birth points to the first (as before).
  const made = inputs.map((input, i) => {
    const id = newId();
    // Without a date of birth there is nothing to match on; the check runs when they add it.
    const k = input.dateOfBirth ? `${norm(input.name)}|${input.dateOfBirth}` : null;
    const duplicateOf = k ? (firstMatch.get(k) ?? null) : null;
    if (k && !duplicateOf) firstMatch.set(k, id);
    return { id, code: `ATG${yy}${String(seq[i]!.n).padStart(5, '0')}`, input, duplicateOf };
  });
  // In chunks: PostgreSQL takes at most 65,535 values in one statement.
  for (const part of chunks(made, 1000)) {
    await trx
      .insertInto('users')
      .values(part.map(({ id, input }) => ({ id, name: input.name, phone: input.phone, email: input.email ?? null, date_of_birth: input.dateOfBirth ?? null, status: 'invited' as const })))
      .execute();
    await trx
      .insertInto('candidate_profiles')
      .values(
        part.map(({ id, code, input, duplicateOf }) => ({
          user_id: id,
          candidate_code: code,
          city: input.city ?? null,
          state: input.state ?? null,
          skill_areas: input.skillAreas,
          experience_months: input.experienceMonths,
          education: input.education ?? null,
          languages: input.languages,
          verification_status: 'pending' as const,
          duplicate_of: duplicateOf,
          source,
          created_by: req.actor?.userId ?? null,
        })),
      )
      .execute();
    await trx
      .insertInto('role_assignments')
      .values(part.map(({ id }) => ({ id: newId(), user_id: id, role: 'learner' as const, granted_by: req.actor?.userId ?? null })))
      .execute();
    await auditMany(
      trx,
      auditCtx(req),
      part.map(({ id, code, input, duplicateOf }) => ({
        action: 'candidate.imported',
        entityType: 'user',
        entityId: id,
        after: { candidate_code: code, name: input.name, city: input.city ?? null, duplicate_of: duplicateOf },
      })),
    );
  }
  return made.map(({ id, code }) => ({ id, code }));
}
