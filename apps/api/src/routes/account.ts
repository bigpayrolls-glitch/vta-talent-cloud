import { ACTIVE_APPLICATION_STATUSES, closureRequestSchema, NOTICE_VERSION, reasonSchema, uuidSchema, optionalReasonSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../app.js';
import { audit } from '../audit/service.js';
import { revokeUserSessions } from '../auth/sessions.js';
import { newId } from '../lib/crypto.js';
import { conflict, invalid, notFound } from '../lib/errors.js';
import { notify, vtaReviewers } from '../lib/notify.js';
import { iso, parse } from '../lib/validate.js';
import { recordConsent } from './learner/service.js';

/**
 * Phase 9 (requirements §15 Privacy: "define retention, export and deletion handling").
 * - A learner downloads everything the platform keeps about them, as one JSON file.
 * - A learner asks VTA to close their account. VTA completes it: the account is deactivated, open applications
 *   are withdrawn and the profile leaves employer search. Records are kept, not erased, until VTA sets a
 *   retention rule (requirements §13: deactivate rather than delete records with linked transactions).
 */
export const accountRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/me/export', { config: { permission: 'learner.self', rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const userId = req.actor!.userId;
    const user = await db.selectFrom('users').select(['name', 'email', 'phone', 'date_of_birth', 'created_at']).where('id', '=', userId).executeTakeFirstOrThrow();
    const profile = await db.selectFrom('candidate_profiles').selectAll().where('user_id', '=', userId).executeTakeFirst();
    const consents = await db.selectFrom('consent_events').select(['purpose', 'granted', 'notice_version', 'source', 'created_at']).where('user_id', '=', userId).orderBy('created_at').execute();
    const enrolments = await db
      .selectFrom('enrolments as e')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
      .select(['e.id', 'c.title as course', 'b.name as batch', 'ce.name as centre', 'b.start_date', 'b.end_date', 'e.status', 'e.enrolled_at', 'e.withdrawn_at', 'e.attendance_pct'])
      .where('e.candidate_id', '=', userId)
      .orderBy('e.enrolled_at')
      .execute();
    const attendance = await db
      .selectFrom('attendance_records as r')
      .innerJoin('attendance_sessions as s', 's.id', 'r.session_id')
      .innerJoin('batches as b', 'b.id', 's.batch_id')
      .select(['b.name as batch', 's.session_date', 'r.status'])
      .where('r.candidate_id', '=', userId)
      .orderBy('s.session_date')
      .execute();
    const results = await db
      .selectFrom('assessment_results as r')
      .innerJoin('enrolments as e', 'e.id', 'r.enrolment_id')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .select(['c.title as course', 'r.total_score', 'r.max_score', 'r.outcome', 'r.released_at'])
      .where('e.candidate_id', '=', userId)
      .where('r.status', '=', 'approved') // only released results, as the learner sees them in the app
      .execute();
    const certificates = await db.selectFrom('credentials').select(['course_title', 'issue_date', 'issuer_name', 'verification_code', 'status', 'created_at']).where('candidate_id', '=', userId).execute();
    const applications = await db
      .selectFrom('job_applications as a')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .innerJoin('organisations as o', 'o.id', 'j.organisation_id')
      .select(['a.id', 'j.title as job', 'o.legal_name as employer', 'a.status', 'a.applied_at', 'a.joining_date', 'a.consent_snapshot'])
      .where('a.candidate_id', '=', userId)
      .orderBy('a.applied_at')
      .execute();
    const documents = await db
      .selectFrom('documents')
      .select(['title', 'kind', 'original_name', 'mime_type', 'size_bytes', 'visibility', 'verification_status', 'created_at'])
      .where('owner_user_id', '=', userId)
      .where('organisation_id', 'is', null)
      .where('deleted_at', 'is', null)
      .execute();
    await audit(db, auditCtx(req), { action: 'learner.data_exported', entityType: 'user', entityId: userId });

    const out = {
      about: 'Everything AutoTalent Grid keeps about you, as of the time below. Your uploaded files themselves can be opened from Documents in the app.',
      exportedAt: new Date().toISOString(),
      noticeVersion: NOTICE_VERSION,
      account: { name: user.name, mobile: user.phone, email: user.email, dateOfBirth: user.date_of_birth, createdAt: iso(user.created_at) },
      profile: profile
        ? {
            candidateCode: profile.candidate_code,
            city: profile.city,
            state: profile.state,
            preferredWorkArea: profile.preferred_work_area,
            skillAreas: profile.skill_areas,
            experienceMonths: profile.experience_months,
            education: profile.education,
            languages: profile.languages,
            availability: profile.availability,
            employersCanFindMe: profile.searchable,
            verificationStatus: profile.verification_status,
            verifiedAt: iso(profile.verified_at),
          }
        : null,
      consents: consents.map((c) => ({ purpose: c.purpose, granted: c.granted, noticeVersion: c.notice_version, recordedBy: c.source, at: iso(c.created_at) })),
      training: enrolments.map((e) => ({ course: e.course, batch: e.batch, centre: e.centre, start: e.start_date, end: e.end_date, status: e.status, attendancePercent: e.attendance_pct == null ? null : Number(e.attendance_pct), enrolledAt: iso(e.enrolled_at), withdrawnAt: iso(e.withdrawn_at) })),
      attendance: attendance.map((a) => ({ batch: a.batch, date: a.session_date, status: a.status })),
      results: results.map((r) => ({ course: r.course, score: `${r.total_score}/${r.max_score}`, outcome: r.outcome, releasedAt: iso(r.released_at) })),
      certificates: certificates.map((c) => ({ course: c.course_title, issued: c.issue_date, issuer: c.issuer_name, checkCode: c.verification_code, status: c.status })),
      applications: applications.map((a) => ({ job: a.job, employer: a.employer, status: a.status, appliedAt: iso(a.applied_at), joiningDate: a.joining_date, sharedWithEmployer: typeof a.consent_snapshot === 'string' ? JSON.parse(a.consent_snapshot) : a.consent_snapshot })),
      documents: documents.map((d) => ({ title: d.title, kind: d.kind, fileName: d.original_name, type: d.mime_type, sizeBytes: d.size_bytes, visibleToEmployers: d.visibility === 'employers', verification: d.verification_status, uploadedAt: iso(d.created_at) })),
    };
    reply.header('content-type', 'application/json; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="vta-talent-cloud-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
    reply.header('cache-control', 'no-store');
    return JSON.stringify(out, null, 2);
  });

  // ---- closing an account ----

  const openRequest = (userId: string) =>
    db.selectFrom('account_requests').selectAll().where('user_id', '=', userId).where('kind', '=', 'closure').where('status', '=', 'open').executeTakeFirst();

  app.get('/me/closure-request', { config: { permission: 'learner.self' } }, async (req) => {
    const r = await openRequest(req.actor!.userId);
    return { request: r ? { id: r.id, reason: r.reason, createdAt: iso(r.created_at) } : null };
  });

  app.post('/me/closure-request', { config: { permission: 'learner.self', rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(closureRequestSchema, req.body);
    const userId = req.actor!.userId;
    if (await openRequest(userId)) throw conflict('You have already asked to close your account. AutoTalent Grid will be in touch.');
    const id = newId();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('account_requests').values({ id, user_id: userId, kind: 'closure', reason: b.reason ?? null }).execute();
      // Leave employer search straight away; the rest waits for VTA.
      const p = await trx.updateTable('candidate_profiles').set({ searchable: false, updated_at: new Date() }).where('user_id', '=', userId).where('searchable', '=', true).returning('user_id').executeTakeFirst();
      if (p) await recordConsent(trx, { userId, purpose: 'profile_searchable', granted: false, source: 'self', recordedBy: userId });
      await audit(trx, auditCtx(req), { action: 'account.closure_requested', entityType: 'user', entityId: userId, after: { requestId: id, reason: b.reason ?? null, leftSearch: !!p } });
      await notify(trx, await vtaReviewers(trx), 'account_closure_requested', {}, `/admin/users/${userId}`);
    });
    reply.code(201);
    return { id };
  });

  app.post('/me/closure-request/cancel', { config: { permission: 'learner.self' } }, async (req) => {
    const r = await openRequest(req.actor!.userId);
    if (!r) throw notFound('Open request');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('account_requests').set({ status: 'cancelled', resolved_by: req.actor!.userId, resolved_at: new Date() }).where('id', '=', r.id).execute();
      await audit(trx, auditCtx(req), { action: 'account.closure_cancelled', entityType: 'user', entityId: req.actor!.userId, after: { requestId: r.id } });
    });
    return { ok: true };
  });

  // ---- VTA ----

  app.get('/admin/account-requests', { config: { permission: 'user.read' } }, async (req) => {
    const f = parse(z.object({ status: z.enum(['open', 'completed', 'declined', 'cancelled']).default('open'), userId: uuidSchema.optional() }), req.query);
    let q = db.selectFrom('account_requests as r').innerJoin('users as u', 'u.id', 'r.user_id').where('r.status', '=', f.status);
    if (f.userId) q = q.where('r.user_id', '=', f.userId);
    const rows = await q
      .select(['r.id', 'r.user_id', 'u.name', 'r.kind', 'r.reason', 'r.status', 'r.resolution_note', 'r.created_at', 'r.resolved_at'])
      .orderBy('r.created_at')
      .limit(200)
      .execute();
    return {
      items: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name, kind: r.kind, reason: r.reason, status: r.status, resolutionNote: r.resolution_note, createdAt: iso(r.created_at), resolvedAt: iso(r.resolved_at) })),
    };
  });

  const loadOpen = async (id: string) => {
    const r = await db.selectFrom('account_requests').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound('Request');
    if (r.status !== 'open') throw invalid(`This request is already ${r.status}.`);
    return r;
  };
  const idParam = z.object({ id: uuidSchema });

  /** Closes the account: deactivated, signed out, open applications withdrawn, out of search. Records are kept. */
  app.post('/admin/account-requests/:id/complete', { config: { permission: 'user.deactivate' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const note = parse(optionalReasonSchema, req.body).reason ?? null;
    const r = await loadOpen(id);
    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('account_requests').set({ status: 'completed', resolution_note: note, resolved_by: req.actor!.userId, resolved_at: now }).where('id', '=', id).execute();
      const user = await trx.selectFrom('users').select('status').where('id', '=', r.user_id).executeTakeFirstOrThrow();
      await trx.updateTable('users').set({ status: 'deactivated', updated_at: now }).where('id', '=', r.user_id).execute();
      await trx.updateTable('candidate_profiles').set({ searchable: false, updated_at: now }).where('user_id', '=', r.user_id).execute();
      const open = await trx.selectFrom('job_applications').select(['id', 'status']).where('candidate_id', '=', r.user_id).where('status', 'in', ACTIVE_APPLICATION_STATUSES).forUpdate().execute();
      for (const a of open) {
        await trx.updateTable('job_applications').set({ status: 'withdrawn', updated_at: now }).where('id', '=', a.id).execute();
        await trx.insertInto('application_events').values({ id: newId(), application_id: a.id, from_status: a.status, to_status: 'withdrawn', actor_id: req.actor!.userId, actor_kind: 'vta' }).execute();
      }
      await audit(trx, auditCtx(req), { action: 'account.closed', entityType: 'user', entityId: r.user_id, before: { status: user.status }, after: { status: 'deactivated', requestId: id, applicationsWithdrawn: open.length, note } });
    });
    await revokeUserSessions(db, r.user_id);
    return { ok: true };
  });

  app.post('/admin/account-requests/:id/decline', { config: { permission: 'user.deactivate' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonSchema, req.body);
    const r = await loadOpen(id);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('account_requests').set({ status: 'declined', resolution_note: reason, resolved_by: req.actor!.userId, resolved_at: new Date() }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'account.closure_declined', entityType: 'user', entityId: r.user_id, after: { requestId: id, reason } });
    });
    return { ok: true };
  });
};
