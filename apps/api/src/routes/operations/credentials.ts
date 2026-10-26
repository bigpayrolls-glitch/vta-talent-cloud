import { CREDENTIAL_DISCLAIMER, CREDENTIAL_TYPE_LABEL, listQuerySchema, reasonSchema, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import type { Database } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { todayIst } from '../../lib/dates.js';
import { invalid, notFound } from '../../lib/errors.js';
import { iso, parse } from '../../lib/validate.js';
import { batchManageScope, inScope, isPlatformAdmin } from '../../policy/index.js';

const idParam = z.object({ id: uuidSchema });

/** 160 random bits as 32 base-32 characters (no i, l, o or 1 to avoid misreading). Unguessable; printed as a QR link. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz023456789';
export function newVerificationCode(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/**
 * AD-07 / §13: a credential is issued only when all three separate states are true:
 * the enrolment is completed (attendance rule), the live result is approved, and it is a pass.
 */
export async function eligibility(db: DB | Transaction<Database>, enrolmentId: string): Promise<{ ok: true; resultId: string } | { ok: false; reason: string }> {
  const e = await db.selectFrom('enrolments').select(['status']).where('id', '=', enrolmentId).executeTakeFirst();
  if (!e) return { ok: false, reason: 'Enrolment not found' };
  if (e.status !== 'completed') return { ok: false, reason: e.status === 'not_completed' ? 'Did not meet the attendance needed to complete' : 'Course not completed yet' };
  const r = await db.selectFrom('assessment_results').select(['id', 'status', 'outcome']).where('enrolment_id', '=', enrolmentId).where('status', '!=', 'rejected').executeTakeFirst();
  if (!r || r.status !== 'approved') return { ok: false, reason: r ? `Assessment ${r.status}, not approved yet` : 'No assessment recorded' };
  if (r.outcome !== 'pass') return { ok: false, reason: 'Assessment not passed' };
  const active = await db.selectFrom('credentials').select('id').where('enrolment_id', '=', enrolmentId).where('status', '=', 'active').executeTakeFirst();
  if (active) return { ok: false, reason: 'Credential already issued' };
  return { ok: true, resultId: r.id };
}

async function issue(trx: Transaction<Database>, req: FastifyRequest, enrolmentId: string, resultId: string, issuerName: string, supersedes?: string): Promise<string> {
  const e = await trx
    .selectFrom('enrolments as e')
    .innerJoin('users as u', 'u.id', 'e.candidate_id')
    .innerJoin('batches as b', 'b.id', 'e.batch_id')
    .innerJoin('courses as c', 'c.id', 'b.course_id')
    .select(['e.candidate_id', 'u.name', 'c.id as course_id', 'c.title', 'b.id as batch_id'])
    .where('e.id', '=', enrolmentId)
    .executeTakeFirstOrThrow();
  const id = newId();
  const code = newVerificationCode();
  await trx
    .insertInto('credentials')
    .values({
      id,
      candidate_id: e.candidate_id,
      course_id: e.course_id,
      enrolment_id: enrolmentId,
      result_id: resultId,
      holder_name: e.name,
      course_title: e.title,
      issue_date: todayIst(),
      issuer_name: issuerName,
      verification_code: code,
      status: 'active',
      issued_by: req.actor!.userId,
    })
    .execute();
  await audit(trx, auditCtx(req), {
    action: supersedes ? 'credential.reissued' : 'credential.issued',
    entityType: 'user',
    entityId: e.candidate_id,
    after: { credentialId: id, course: e.title, batchId: e.batch_id, supersedes: supersedes ?? null },
  });
  return id;
}

/** Centre admins see credentials for batches at their centres; platform admins see all. */
const credentialScope = (req: FastifyRequest): 'all' | string[] => batchManageScope(req.actor!);

export const credentialRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const issuerName = app.config.CREDENTIAL_ISSUER_NAME;

  /** Issue credentials to every eligible candidate in a completed batch; report why the others were skipped. */
  app.post('/admin/batches/:id/credentials', { config: { permission: 'credential.issue' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const batch = await db.selectFrom('batches').select(['status']).where('id', '=', id).executeTakeFirst();
    if (!batch) throw notFound('Batch');
    if (batch.status !== 'completed') throw invalid('Mark the batch completed before issuing credentials.');
    const enrolments = await db
      .selectFrom('enrolments as e')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .select(['e.id', 'u.name'])
      .where('e.batch_id', '=', id)
      .where('e.status', '!=', 'withdrawn')
      .execute();
    const issued: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    await db.transaction().execute(async (trx) => {
      for (const e of enrolments) {
        const el = await eligibility(trx, e.id);
        if (el.ok) {
          await issue(trx, req, e.id, el.resultId, issuerName);
          issued.push(e.name);
        } else skipped.push({ name: e.name, reason: el.reason });
      }
    });
    reply.code(issued.length ? 201 : 200);
    return { issued: issued.length, issuedTo: issued, skipped };
  });

  app.post('/admin/enrolments/:id/credential', { config: { permission: 'credential.issue' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const credentialId = await db.transaction().execute(async (trx) => {
      const el = await eligibility(trx, id);
      if (!el.ok) throw invalid(el.reason);
      return issue(trx, req, id, el.resultId, issuerName);
    });
    reply.code(201);
    return { id: credentialId };
  });

  app.get('/admin/credentials', { config: { permission: 'credential.read' } }, async (req) => {
    const f = parse(listQuerySchema.extend({ status: z.enum(['active', 'revoked', 'superseded']).optional(), batchId: uuidSchema.optional() }), req.query);
    const scope = credentialScope(req);
    if (scope !== 'all' && scope.length === 0) return { items: [], page: f.page, pageSize: f.pageSize, total: 0 };
    let q = db
      .selectFrom('credentials as cr')
      .innerJoin('enrolments as e', 'e.id', 'cr.enrolment_id')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'cr.candidate_id');
    if (scope !== 'all') q = q.where('b.centre_id', 'in', scope);
    if (f.status) q = q.where('cr.status', '=', f.status);
    if (f.batchId) q = q.where('b.id', '=', f.batchId);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('cr.holder_name', 'ilike', like), eb('cp.candidate_code', 'ilike', like), eb('cr.course_title', 'ilike', like)]));
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select(['cr.id', 'cr.holder_name', 'cr.course_title', 'cr.issue_date', 'cr.status', 'cr.verification_code', 'cr.candidate_id', 'cp.candidate_code', 'b.id as batch_id', 'b.name as batch_name'])
      .orderBy('cr.created_at', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        holderName: r.holder_name,
        candidateId: r.candidate_id,
        candidateCode: r.candidate_code,
        courseTitle: r.course_title,
        issueDate: r.issue_date,
        status: r.status,
        verificationCode: r.verification_code,
        batch: { id: r.batch_id, name: r.batch_name },
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });

  app.get('/admin/credentials/:id', { config: { permission: 'credential.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await db
      .selectFrom('credentials as cr')
      .innerJoin('enrolments as e', 'e.id', 'cr.enrolment_id')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'cr.candidate_id')
      .leftJoin('users as ib', 'ib.id', 'cr.issued_by')
      .leftJoin('users as rb', 'rb.id', 'cr.revoked_by')
      .selectAll('cr')
      .select(['b.centre_id', 'b.id as batch_id', 'b.name as batch_name', 'cp.candidate_code', 'ib.name as issued_by_name', 'rb.name as revoked_by_name'])
      .where('cr.id', '=', id)
      .executeTakeFirst();
    if (!c || !inScope(credentialScope(req), c.centre_id)) throw notFound('Credential');
    return {
      id: c.id,
      type: CREDENTIAL_TYPE_LABEL[c.credential_type],
      holderName: c.holder_name,
      candidateId: c.candidate_id,
      candidateCode: c.candidate_code,
      courseTitle: c.course_title,
      issueDate: c.issue_date,
      issuerName: c.issuer_name,
      status: c.status,
      verificationCode: c.verification_code,
      verifyPath: `/verify/${c.verification_code}`,
      issuedByName: c.issued_by_name,
      revokedReason: c.revoked_reason,
      revokedAt: iso(c.revoked_at),
      revokedByName: c.revoked_by_name,
      supersededBy: c.superseded_by,
      batch: { id: c.batch_id, name: c.batch_name },
      disclaimer: CREDENTIAL_DISCLAIMER,
      canManage: isPlatformAdmin(req.actor!),
    };
  });

  /** Revoke: the verify page shows "revoked" from then on. Audited with the reason. */
  app.post('/admin/credentials/:id/revoke', { config: { permission: 'credential.revoke' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonSchema, req.body);
    return db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('credentials').select(['status', 'candidate_id']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!c) throw notFound('Credential');
      if (c.status !== 'active') throw invalid(`This credential is already ${c.status}.`);
      await trx.updateTable('credentials').set({ status: 'revoked', revoked_reason: reason, revoked_by: req.actor!.userId, revoked_at: new Date() }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'credential.revoked', entityType: 'user', entityId: c.candidate_id, before: { credentialId: id, status: 'active' }, after: { credentialId: id, status: 'revoked', reason } });
      return { id, status: 'revoked' };
    });
  });

  /** Supersede: issue a fresh credential (for example after a name correction); the old one shows as replaced. */
  app.post('/admin/credentials/:id/reissue', { config: { permission: 'credential.issue' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonSchema, req.body);
    const newId_ = await db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('credentials').select(['status', 'enrolment_id', 'result_id', 'candidate_id']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!c) throw notFound('Credential');
      if (c.status !== 'active') throw invalid('Only an active credential can be reissued.');
      await trx.updateTable('credentials').set({ status: 'superseded', revoked_reason: reason, revoked_by: req.actor!.userId, revoked_at: new Date() }).where('id', '=', id).execute();
      const created = await issue(trx, req, c.enrolment_id, c.result_id, issuerName, id);
      await trx.updateTable('credentials').set({ superseded_by: created }).where('id', '=', id).execute();
      return created;
    });
    reply.code(201);
    return { id: newId_ };
  });

  /**
   * Public QR verification (AD-07): only the approved fields. Nothing else about the candidate.
   * Rate-limited; an unknown code gives the same "not found" for any guess.
   */
  app.get('/public/credentials/:code', { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[a-z0-9]{32}$/) }), req.params);
    const c = await db
      .selectFrom('credentials')
      .select(['holder_name', 'course_title', 'issue_date', 'issuer_name', 'status', 'credential_type', 'revoked_at', 'superseded_by'])
      .where('verification_code', '=', code)
      .executeTakeFirst();
    if (!c) throw notFound('Credential');
    return {
      type: CREDENTIAL_TYPE_LABEL[c.credential_type],
      holderName: c.holder_name,
      courseTitle: c.course_title,
      issueDate: c.issue_date,
      issuerName: c.issuer_name,
      status: c.status,
      statusChangedAt: c.status === 'active' ? null : iso(c.revoked_at),
      disclaimer: CREDENTIAL_DISCLAIMER,
    };
  });
};
