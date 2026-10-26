import { moderationSchema, outcomeReviewSchema, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { invalid, notFound } from '../../lib/errors.js';
import { LINK_TTL_SECONDS, signLink } from '../../lib/storage.js';
import { iso, parse } from '../../lib/validate.js';
import { companyDto } from './company.js';
import { jobDto, likeEscape } from './common.js';

const idParam = z.object({ id: uuidSchema });

/** AD-08 (company documents), AD-09 (job moderation) and EM-08 (VTA follow-up on recorded joinings). */
export const hiringAdminRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  // ---- company profile and documents for verification ----

  app.get('/admin/organisations/:id/company', { config: { permission: 'organisation.verify' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const org = await db.selectFrom('organisations').selectAll().where('id', '=', id).where('type', '!=', 'vta').executeTakeFirst();
    if (!org) throw notFound('Organisation');
    const docs = await db.selectFrom('documents').select(['id', 'title', 'mime_type', 'size_bytes', 'created_at']).where('organisation_id', '=', id).where('deleted_at', 'is', null).orderBy('created_at', 'desc').execute();
    const dup = org.duplicate_of ? await db.selectFrom('organisations').select(['id', 'legal_name', 'verification_status']).where('id', '=', org.duplicate_of).executeTakeFirst() : null;
    return {
      ...companyDto(org),
      verificationReason: org.verification_reason,
      programmeInterests: org.programme_interests,
      registrationNumber: ((typeof org.registration_ids === 'string' ? JSON.parse(org.registration_ids) : org.registration_ids) as Record<string, string>).registrationNumber ?? null,
      possibleDuplicate: dup ? { id: dup.id, legalName: dup.legal_name, verificationStatus: dup.verification_status } : null,
      documents: docs.map((d) => ({ id: d.id, title: d.title, mimeType: d.mime_type, sizeBytes: d.size_bytes, createdAt: iso(d.created_at) })),
    };
  });

  app.get('/admin/organisations/:id/documents/:docId/link', { config: { permission: 'organisation.verify' } }, async (req) => {
    const { id, docId } = parse(z.object({ id: uuidSchema, docId: uuidSchema }), req.params);
    const d = await db.selectFrom('documents').select(['id', 'title']).where('id', '=', docId).where('organisation_id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!d) throw notFound('Document');
    const { exp, sig } = signLink(app.config.fileSigningSecret, d.id);
    await audit(db, auditCtx(req), { action: 'document.link_created', entityType: 'organisation', entityId: id, after: { documentId: d.id, title: d.title } });
    return { url: `/api/v1/files/${d.id}/content?exp=${exp}&sig=${sig}`, expiresInSeconds: LINK_TTL_SECONDS };
  });

  // ---- job moderation (AD-09) ----

  app.get('/admin/jobs', { config: { permission: 'job.moderate' } }, async (req) => {
    const f = parse(
      z.object({
        status: z.enum(['draft', 'pending_review', 'published', 'paused', 'closed', 'rejected']).optional(),
        q: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
      req.query,
    );
    let q = db.selectFrom('jobs as j').innerJoin('organisations as o', 'o.id', 'j.organisation_id').where('j.status', '!=', 'draft');
    if (f.status) q = q.where('j.status', '=', f.status);
    if (f.q) q = q.where((eb) => eb.or([eb('j.title', 'ilike', likeEscape(f.q!)), eb('o.legal_name', 'ilike', likeEscape(f.q!))]));
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .selectAll('j')
      .select(['o.legal_name', 'o.verification_status as org_status'])
      .orderBy(sql`case when j.status = 'pending_review' then 0 else 1 end`)
      .orderBy('j.submitted_at', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => jobDto(r, { employer: r.legal_name, employerVerification: r.org_status, submittedAt: iso(r.submitted_at), moderationReason: r.moderation_reason })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });

  app.get('/admin/jobs/:id', { config: { permission: 'job.moderate' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const j = await db.selectFrom('jobs as j').innerJoin('organisations as o', 'o.id', 'j.organisation_id').selectAll('j').select(['o.legal_name', 'o.verification_status as org_status', 'o.id as org_id']).where('j.id', '=', id).executeTakeFirst();
    if (!j || j.status === 'draft') throw notFound('Job');
    const counts = await db.selectFrom('job_applications').select(['status', sql<string>`count(*)`.as('n')]).where('job_id', '=', id).groupBy('status').execute();
    return jobDto(j, {
      employer: j.legal_name,
      employerId: j.org_id,
      employerVerification: j.org_status,
      submittedAt: iso(j.submitted_at),
      moderationReason: j.moderation_reason,
      moderatedAt: iso(j.moderated_at),
      pipeline: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    });
  });

  const RULES = {
    publish: { from: ['pending_review', 'paused'], to: 'published' },
    reject: { from: ['pending_review'], to: 'rejected' },
    pause: { from: ['published'], to: 'paused' },
    close: { from: ['pending_review', 'published', 'paused'], to: 'closed' },
  } as const;

  app.post('/admin/jobs/:id/moderate', { config: { permission: 'job.moderate' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(moderationSchema, req.body);
    const j = await db.selectFrom('jobs as j').innerJoin('organisations as o', 'o.id', 'j.organisation_id').selectAll('j').select(['o.verification_status as org_status']).where('j.id', '=', id).executeTakeFirst();
    if (!j || j.status === 'draft') throw notFound('Job');
    const rule = RULES[b.action];
    if (!(rule.from as readonly string[]).includes(j.status)) throw invalid(`A job that is ${j.status.replace('_', ' ')} cannot be ${b.action === 'publish' ? 'published' : `${b.action}${b.action.endsWith('e') ? 'd' : 'ed'}`}.`);
    if (b.action === 'publish' && j.org_status !== 'verified') throw invalid('Verify the employer before publishing its jobs.');
    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('jobs')
        .set({
          status: rule.to,
          moderation_reason: b.reason ?? null,
          moderated_by: req.actor!.userId,
          moderated_at: now,
          updated_at: now,
          ...(b.action === 'publish' && !j.published_at ? { published_at: now } : {}),
        })
        .where('id', '=', id)
        .execute();
      await audit(trx, auditCtx(req), { action: `job.moderation.${b.action}`, entityType: 'job', entityId: id, before: { status: j.status }, after: { status: rule.to, reason: b.reason ?? null } });
    });
    return { ok: true, status: rule.to };
  });

  // ---- joining outcomes (EM-08) ----

  app.get('/admin/hiring-outcomes', { config: { permission: 'hiring.read' } }, async (req) => {
    const f = parse(
      z.object({ verification: z.enum(['unverified', 'verified', 'flagged']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }),
      req.query,
    );
    let q = db
      .selectFrom('job_applications as a')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .innerJoin('organisations as o', 'o.id', 'j.organisation_id')
      .innerJoin('users as u', 'u.id', 'a.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'a.candidate_id')
      .where('a.status', 'in', ['joined', 'not_joined']);
    if (f.verification) q = q.where('a.outcome_verification', '=', f.verification);
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select(['a.id', 'a.status', 'a.joining_date', 'a.outcome_verification', 'a.outcome_note', 'a.updated_at', 'j.title', 'o.legal_name', 'u.name', 'cp.candidate_code', 'u.id as candidate_id'])
      .orderBy(sql`case when a.outcome_verification = 'unverified' then 0 when a.outcome_verification = 'flagged' then 1 else 2 end`)
      .orderBy('a.updated_at', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        joiningDate: r.joining_date,
        verification: r.outcome_verification,
        note: r.outcome_note,
        recordedAt: iso(r.updated_at),
        job: r.title,
        employer: r.legal_name,
        candidate: { id: r.candidate_id, name: r.name, code: r.candidate_code },
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });

  /** VTA confirms a recorded joining (for example after calling the employer and candidate) or flags it for follow-up. */
  app.post('/admin/applications/:id/outcome-review', { config: { permission: 'hiring.verify' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(outcomeReviewSchema, req.body);
    const a = await db.selectFrom('job_applications').selectAll().where('id', '=', id).executeTakeFirst();
    if (!a || (a.status !== 'joined' && a.status !== 'not_joined')) throw notFound('Hiring outcome');
    if (b.decision === 'flagged' && !b.note) throw invalid('Say what needs following up', { note: 'Give a reason' });
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('job_applications')
        .set({ outcome_verification: b.decision, outcome_note: b.note ?? null, outcome_reviewed_by: req.actor!.userId, outcome_reviewed_at: new Date() })
        .where('id', '=', id)
        .execute();
      await audit(trx, auditCtx(req), { action: `hiring.outcome_${b.decision}`, entityType: 'application', entityId: id, before: { verification: a.outcome_verification }, after: { verification: b.decision, note: b.note ?? null } });
    });
    return { ok: true };
  });
};
