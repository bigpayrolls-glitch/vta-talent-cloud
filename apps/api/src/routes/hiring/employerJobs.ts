import {
  ACTIVE_APPLICATION_STATUSES,
  APPLICATION_STATUSES,
  EMPLOYER_MOVES,
  interviewSchema,
  jobSchema,
  moveApplicationSchema,
  uuidSchema,
  type ApplicationStatus,
} from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { JobApplication } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { formatIstDateTime, todayIst } from '../../lib/dates.js';
import { notify, vtaReviewers } from '../../lib/notify.js';
import { invalid, notFound } from '../../lib/errors.js';
import { LINK_TTL_SECONDS, signLink } from '../../lib/storage.js';
import { assertActiveJobRoom, assertApplicationOpen, assertFeature, currentSubscription, lockedApplicationIds } from '../../lib/subscriptions.js';
import { iso, parse } from '../../lib/validate.js';
import { employerPlan } from '../../lib/plans.js';
import { assertVerified, certificatesOf, employerOrg, employerOrgId, jobDto, ownJob, sharedDocumentsOf } from './common.js';

const idParam = z.object({ id: uuidSchema });

/** Statuses an employer may still change a job's content in; editing a live job sends it back to VTA. */
const EDITABLE = ['draft', 'rejected', 'pending_review', 'published', 'paused'] as const;

/** EM-03, EM-06 to EM-09: the employer's jobs and the people who applied. */
export const employerJobRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const jobRow = (b: z.output<typeof jobSchema>) => ({
    title: b.title,
    skill_area: b.skillArea,
    skills: b.skills,
    min_experience_months: b.minExperienceMonths,
    city: b.city,
    location: b.location ?? null,
    salary_min: b.salaryMin ?? null,
    salary_max: b.salaryMax ?? null,
    openings: b.openings,
    shift: b.shift ?? null,
    description: b.description,
    closing_date: b.closingDate,
    vta_certificate_preferred: b.vtaCertificatePreferred,
  });

  const pipelineCounts = async (jobIds: string[]) => {
    if (!jobIds.length) return new Map<string, Partial<Record<ApplicationStatus, number>>>();
    const rows = await db.selectFrom('job_applications').select(['job_id', 'status', sql<string>`count(*)`.as('n')]).where('job_id', 'in', jobIds).groupBy(['job_id', 'status']).execute();
    const m = new Map<string, Partial<Record<ApplicationStatus, number>>>();
    for (const r of rows) m.set(r.job_id, { ...(m.get(r.job_id) ?? {}), [r.status]: Number(r.n) });
    return m;
  };

  // ---------------------------------------------------------------- jobs (EM-03)

  app.get('/employer/jobs', { config: { permission: 'job.manage' } }, async (req) => {
    const { status } = parse(z.object({ status: z.enum(['draft', 'pending_review', 'published', 'paused', 'closed', 'rejected']).optional() }), req.query);
    let q = db.selectFrom('jobs').selectAll().where('organisation_id', '=', employerOrgId(req));
    if (status) q = q.where('status', '=', status);
    const jobs = await q.orderBy('created_at', 'desc').limit(200).execute();
    const counts = await pipelineCounts(jobs.map((j) => j.id));
    return { items: jobs.map((j) => jobDto(j, { moderationReason: j.moderation_reason, pipeline: counts.get(j.id) ?? {} })) };
  });

  app.post('/employer/jobs', { config: { permission: 'job.manage' } }, async (req, reply) => {
    const b = parse(jobSchema, req.body);
    const org = await employerOrg(db, req);
    if (b.closingDate < todayIst()) throw invalid('The closing date has passed', { closingDate: 'Choose today or later' });
    const id = newId();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('jobs').values({ id, organisation_id: org.id, created_by: req.actor!.userId, ...jobRow(b) }).execute();
      await audit(trx, auditCtx(req), { action: 'job.created', entityType: 'job', entityId: id, after: { title: b.title, organisation_id: org.id } });
    });
    reply.code(201);
    return jobDto((await ownJob(db, req, id)));
  });

  app.get('/employer/jobs/:id', { config: { permission: 'job.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const j = await ownJob(db, req, id);
    return jobDto(j, { moderationReason: j.moderation_reason, pipeline: (await pipelineCounts([j.id])).get(j.id) ?? {} });
  });

  app.put('/employer/jobs/:id', { config: { permission: 'job.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(jobSchema, req.body);
    const j = await ownJob(db, req, id);
    if (!(EDITABLE as readonly string[]).includes(j.status)) throw invalid('A closed job cannot be changed. Post a new one.');
    if (b.closingDate < todayIst()) throw invalid('The closing date has passed', { closingDate: 'Choose today or later' });
    // A change to a job VTA already reviewed goes back to VTA before learners see it.
    const nextStatus = j.status === 'published' || j.status === 'paused' ? 'pending_review' : j.status;
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('jobs')
        .set({ ...jobRow(b), status: nextStatus, submitted_at: nextStatus === 'pending_review' ? new Date() : j.submitted_at, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await audit(trx, auditCtx(req), { action: 'job.updated', entityType: 'job', entityId: id, before: { title: j.title, status: j.status }, after: { title: b.title, status: nextStatus } });
    });
    return jobDto(await ownJob(db, req, id));
  });

  /** Employer actions on a job's status. Publishing is VTA's decision (AD-09). */
  const transitions = {
    submit: { from: ['draft', 'rejected'], to: 'pending_review', needsVerified: true },
    pause: { from: ['published'], to: 'paused', needsVerified: false },
    resume: { from: ['paused'], to: 'published', needsVerified: true },
    close: { from: ['draft', 'pending_review', 'published', 'paused', 'rejected'], to: 'closed', needsVerified: false },
  } as const;
  for (const [action, t] of Object.entries(transitions)) {
    app.post(`/employer/jobs/:id/${action}`, { config: { permission: 'job.manage' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const j = await ownJob(db, req, id);
      if (t.needsVerified) assertVerified(await employerOrg(db, req));
      if (!(t.from as readonly string[]).includes(j.status)) throw invalid(`This job is ${j.status.replace('_', ' ')} and cannot be ${action === 'submit' ? 'sent for review' : `${action}d`}.`);
      if (action === 'resume' && j.closing_date < todayIst()) throw invalid('The closing date has passed. Edit the job to set a new one.');
      // Phase 12: sending for review or resuming makes the job active, which counts against the plan.
      if (action === 'submit' || action === 'resume') await assertActiveJobRoom(db, j.organisation_id, j.id);
      const now = new Date();
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('jobs')
          .set({ status: t.to, updated_at: now, ...(action === 'submit' ? { submitted_at: now, moderation_reason: null } : {}) })
          .where('id', '=', id)
          .execute();
        await audit(trx, auditCtx(req), { action: `job.${action === 'submit' ? 'submitted' : action === 'resume' ? 'resumed' : `${action}d`}`, entityType: 'job', entityId: id, before: { status: j.status }, after: { status: t.to } });
        if (action === 'submit') await notify(trx, await vtaReviewers(trx), 'job_submitted', await jobContext(trx, id), `/admin/jobs/${id}`);
      });
      return jobDto(await ownJob(db, req, id));
    });
  }

  // ---------------------------------------------------------------- applications (EM-06)

  /** An application of this employer's, with its job. Anything else is "not found". */
  const ownApplication = async (req: FastifyRequest, id: string) => {
    const a = await db
      .selectFrom('job_applications as a')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .selectAll('a')
      .select(['j.title as job_title', 'j.organisation_id'])
      .where('a.id', '=', id)
      .where('j.organisation_id', '=', employerOrgId(req))
      .executeTakeFirst();
    if (!a) throw notFound('Application');
    await assertApplicationOpen(db, a.organisation_id, a.id);
    return a;
  };

  app.get('/employer/jobs/:id/applications', { config: { permission: 'application.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(z.object({ status: z.enum(APPLICATION_STATUSES).optional() }), req.query);
    await ownJob(db, req, id);
    let q = db
      .selectFrom('job_applications as a')
      .innerJoin('users as u', 'u.id', 'a.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'a.candidate_id')
      .select(['a.id', 'a.status', 'a.applied_at', 'a.updated_at', 'u.name', 'cp.city', 'cp.skill_areas', 'cp.experience_months', 'cp.verification_status'])
      .where('a.job_id', '=', id);
    if (status) q = q.where('a.status', '=', status);
    const rows = await q.orderBy('a.applied_at', 'desc').execute();
    const locked = await lockedApplicationIds(db, employerOrgId(req), rows.map((r) => r.id));
    const certs = rows.length
      ? await db
          .selectFrom('credentials as c')
          .innerJoin('job_applications as a', 'a.candidate_id', 'c.candidate_id')
          .select(['a.id', sql<string>`count(*)`.as('n')])
          .where('a.id', 'in', rows.map((r) => r.id))
          .where('c.status', '=', 'active')
          .groupBy('a.id')
          .execute()
      : [];
    return {
      items: rows.map((r) =>
        // Phase 12: beyond the plan's applicant limit, only the fact and date of the application are shown.
        locked.has(r.id)
          ? { id: r.id, status: r.status, appliedAt: iso(r.applied_at), updatedAt: iso(r.updated_at), locked: true, name: 'Hidden applicant', city: null, skillAreas: [], experienceMonths: null, verificationStatus: null, vtaCertificates: 0 }
          : {
              id: r.id,
              status: r.status,
              appliedAt: iso(r.applied_at),
              updatedAt: iso(r.updated_at),
              locked: false,
              // The person applied to this employer, so their name is shared; phone and email are on the detail page (logged).
              name: r.status === 'withdrawn' ? 'Withdrawn applicant' : r.name,
              city: r.city,
              skillAreas: r.skill_areas,
              experienceMonths: r.experience_months,
              verificationStatus: r.verification_status,
              vtaCertificates: Number(certs.find((c) => c.id === r.id)?.n ?? 0),
            },
      ),
      lockedCount: locked.size,
    };
  });

  const timeline = async (applicationId: string) =>
    (
      await db
        .selectFrom('application_events as e')
        .leftJoin('users as u', 'u.id', 'e.actor_id')
        .select(['e.id', 'e.from_status', 'e.to_status', 'e.actor_kind', 'e.created_at', 'u.name'])
        .where('e.application_id', '=', applicationId)
        .orderBy('e.created_at')
        .orderBy('e.id')
        .execute()
    ).map((e) => ({ id: e.id, from: e.from_status, to: e.to_status, by: e.actor_kind, byName: e.actor_kind === 'employer' ? e.name : null, at: iso(e.created_at) }));

  const interviewsOf = async (applicationId: string) =>
    (await db.selectFrom('interviews').selectAll().where('application_id', '=', applicationId).orderBy('scheduled_at').execute()).map((i) => ({
      id: i.id,
      scheduledAt: iso(i.scheduled_at),
      mode: i.mode,
      location: i.location,
      outcome: i.outcome,
      internalNotes: i.internal_notes,
    }));

  /**
   * EM-05 / EM-10: the applicant's profile. Contact details are shared because the person applied to this job
   * (their consent is stored with the application); every opening of them is logged. A withdrawn applicant's
   * contact details are no longer shown.
   */
  app.get('/employer/applications/:id', { config: { permission: 'application.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await ownApplication(req, id);
    const p = await db
      .selectFrom('users as u')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
      .select(['u.name', 'u.phone', 'u.email', 'cp.candidate_code', 'cp.city', 'cp.state', 'cp.preferred_work_area', 'cp.skill_areas', 'cp.experience_months', 'cp.education', 'cp.languages', 'cp.availability', 'cp.willing_to_relocate', 'cp.verification_status'])
      .where('u.id', '=', a.candidate_id)
      .executeTakeFirstOrThrow();
    const { plan } = await currentSubscription(db, a.organisation_id);
    const planInfo = await employerPlan(db, plan);
    const contactOnPlan = planInfo.contactDetails;
    const contactShared = a.status !== 'withdrawn' && contactOnPlan;
    if (contactShared) {
      await audit(db, auditCtx(req), { action: 'application.contact_viewed', entityType: 'user', entityId: a.candidate_id, after: { applicationId: a.id, organisationId: a.organisation_id } });
    }
    return {
      id: a.id,
      jobId: a.job_id,
      jobTitle: a.job_title,
      status: a.status,
      appliedAt: iso(a.applied_at),
      note: a.note,
      joiningDate: a.joining_date,
      expectedJoiningDate: a.expected_joining_date,
      outcomeVerification: a.outcome_verification,
      nextMoves: EMPLOYER_MOVES[a.status],
      consent: a.consent_snapshot,
      candidate: {
        name: a.status !== 'withdrawn' ? p.name : 'Withdrawn applicant',
        phone: contactShared ? p.phone : null,
        email: contactShared ? p.email : null,
        contactShared,
        /** Phase 12: the plan does not include contact details (the person did share them). */
        contactNeedsUpgrade: a.status !== 'withdrawn' && !contactOnPlan,
        code: p.candidate_code,
        city: p.city,
        state: p.state,
        preferredWorkArea: p.preferred_work_area,
        skillAreas: p.skill_areas,
        experienceMonths: p.experience_months,
        education: p.education,
        languages: p.languages,
        availability: p.availability,
        willingToRelocate: p.willing_to_relocate,
        verificationStatus: p.verification_status,
      },
      certificates: contactShared ? await certificatesOf(db, a.candidate_id) : [],
      documents: contactShared ? await sharedDocumentsOf(db, a.candidate_id) : [],
      interviews: await interviewsOf(a.id),
      interviewsOnPlan: planInfo.interviews,
      timeline: await timeline(a.id),
    };
  });

  /** A document the applicant shared with employers. The link is logged (EM-10). */
  app.get('/employer/applications/:id/documents/:docId/link', { config: { permission: 'application.manage' } }, async (req) => {
    const { id, docId } = parse(z.object({ id: uuidSchema, docId: uuidSchema }), req.params);
    const a = await ownApplication(req, id);
    if (a.status === 'withdrawn') throw notFound('Document');
    await assertFeature(db, a.organisation_id, 'contactDetails');
    const d = await db
      .selectFrom('documents')
      .select(['id', 'title'])
      .where('id', '=', docId)
      .where('owner_user_id', '=', a.candidate_id)
      .where('organisation_id', 'is', null)
      .where('visibility', '=', 'employers')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!d) throw notFound('Document');
    const { exp, sig } = signLink(app.config.fileSigningSecret, d.id);
    await audit(db, auditCtx(req), { action: 'application.document_viewed', entityType: 'user', entityId: a.candidate_id, after: { applicationId: a.id, documentId: d.id, title: d.title } });
    return { url: `/api/v1/files/${d.id}/content?exp=${exp}&sig=${sig}`, expiresInSeconds: LINK_TTL_SECONDS };
  });

  /** EM-06 / EM-08: move an application on. Each move is timestamped in the timeline and audited. */
  app.post('/employer/applications/:id/move', { config: { permission: 'application.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(moveApplicationSchema, req.body);
    const a = await ownApplication(req, id);
    if (!EMPLOYER_MOVES[a.status].includes(b.to)) {
      throw invalid(a.status === 'withdrawn' ? 'The candidate withdrew this application.' : `An application that is ${a.status.replace('_', ' ')} cannot move to ${b.to.replace('_', ' ')}.`);
    }
    if (b.to === 'joined' && b.joiningDate! > todayIst()) throw invalid('Record a joining once it has happened', { joiningDate: 'Not in the future' });
    if (b.to === 'offer' && b.expectedJoiningDate! < todayIst()) throw invalid('Check the expected joining date', { expectedJoiningDate: 'Today or later' });
    await moveApplication(req, a, b.to, 'employer', { joining_date: b.to === 'joined' ? b.joiningDate! : null, expected_joining_date: b.to === 'offer' ? b.expectedJoiningDate! : null, reason: b.reason ?? null });
    return { ok: true, status: b.to };
  });

  /** Job title and company name for notification text. */
  const jobContext = (trx: Parameters<typeof notify>[0], jobId: string) =>
    trx.selectFrom('jobs as j').innerJoin('organisations as o', 'o.id', 'j.organisation_id').select(['j.title as job', 'o.legal_name as company']).where('j.id', '=', jobId).executeTakeFirstOrThrow();

  async function moveApplication(req: FastifyRequest, a: JobApplication, to: ApplicationStatus, kind: 'employer', extra: { joining_date: string | null; expected_joining_date?: string | null; reason: string | null }, quiet = false) {
    const now = new Date();
    await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('job_applications')
        .set({ status: to, updated_at: now, ...(to === 'joined' ? { joining_date: extra.joining_date } : {}), ...(to === 'offer' ? { expected_joining_date: extra.expected_joining_date } : {}) })
        .where('id', '=', a.id)
        .where('status', '=', a.status) // someone else may have moved it a moment ago
        .returning('id')
        .executeTakeFirst();
      if (!updated) throw invalid('This application was just changed by someone else. Reload and try again.');
      await trx.insertInto('application_events').values({ id: newId(), application_id: a.id, from_status: a.status, to_status: to, actor_id: req.actor!.userId, actor_kind: kind }).execute();
      await audit(trx, auditCtx(req), { action: 'application.moved', entityType: 'application', entityId: a.id, before: { status: a.status }, after: { status: to, joining_date: extra.joining_date, expected_joining_date: extra.expected_joining_date ?? null, reason: extra.reason } });
      // SH-07: the learner hears about each step (the employer's reason stays internal); VTA hears about joinings to verify.
      const ctx = await jobContext(trx, a.job_id);
      if (!quiet) await notify(trx, [a.candidate_id], 'application_update', { ...ctx, status: to }, `/learn/applications/${a.id}`);
      if (to === 'joined') await notify(trx, await vtaReviewers(trx), 'joining_reported', ctx, '/admin/outcomes');
    });
  }

  // ---------------------------------------------------------------- interviews (EM-07)

  app.post('/employer/applications/:id/interviews', { config: { permission: 'application.manage' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const b = parse(interviewSchema, req.body);
    const a = await ownApplication(req, id);
    await assertFeature(db, a.organisation_id, 'interviews');
    if (!(ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(a.status)) throw invalid('Interviews can be added only while the application is in progress.');
    const iid = newId();
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('interviews')
        .values({ id: iid, application_id: a.id, scheduled_at: new Date(b.scheduledAt), mode: b.mode, location: b.location ?? null, outcome: b.outcome, internal_notes: b.internalNotes ?? null, created_by: req.actor!.userId })
        .execute();
      await audit(trx, auditCtx(req), { action: 'interview.scheduled', entityType: 'application', entityId: a.id, after: { interviewId: iid, scheduled_at: b.scheduledAt, mode: b.mode } });
      if (b.outcome === 'scheduled') {
        const mode = { in_person: 'in person', phone: 'by phone', video: 'by video call' }[b.mode];
        await notify(trx, [a.candidate_id], 'interview_scheduled', { ...(await jobContext(trx, a.job_id)), mode, when: formatIstDateTime(new Date(b.scheduledAt)) }, `/learn/applications/${a.id}`);
      }
    });
    // Scheduling an interview moves a shortlisted application to "interview".
    if (a.status === 'applied' || a.status === 'shortlisted') {
      const from = a.status;
      // Quietly: the learner already has the interview notification.
      if (from === 'applied') await moveApplication(req, a, 'shortlisted', 'employer', { joining_date: null, reason: null }, true);
      await moveApplication(req, { ...a, status: 'shortlisted' }, 'interview', 'employer', { joining_date: null, reason: null }, true);
    }
    reply.code(201);
    return { id: iid };
  });

  app.put('/employer/interviews/:id', { config: { permission: 'application.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(interviewSchema, req.body);
    const i = await db
      .selectFrom('interviews as i')
      .innerJoin('job_applications as a', 'a.id', 'i.application_id')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .selectAll('i')
      .where('i.id', '=', id)
      .where('j.organisation_id', '=', employerOrgId(req))
      .executeTakeFirst();
    if (!i) throw notFound('Interview');
    await assertFeature(db, employerOrgId(req), 'interviews');
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('interviews')
        .set({ scheduled_at: new Date(b.scheduledAt), mode: b.mode, location: b.location ?? null, outcome: b.outcome, internal_notes: b.internalNotes ?? null, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      // Notes stay out of the audit trail's before/after so they are only ever shown to the employer.
      await audit(trx, auditCtx(req), { action: 'interview.updated', entityType: 'application', entityId: i.application_id, before: { outcome: i.outcome, scheduled_at: iso(i.scheduled_at) }, after: { outcome: b.outcome, scheduled_at: b.scheduledAt } });
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- dashboard (EM-09)

  app.get('/employer/dashboard', { config: { permission: 'job.manage' } }, async (req) => {
    const org = await employerOrg(db, req);
    const jobs = await db.selectFrom('jobs').select(['id', 'title', 'status', 'closing_date', 'openings', 'created_at']).where('organisation_id', '=', org.id).where('status', '!=', 'closed').orderBy('created_at', 'desc').limit(50).execute();
    const counts = await pipelineCounts(jobs.map((j) => j.id));
    const interviews = jobs.length
      ? await db
          .selectFrom('interviews as i')
          .innerJoin('job_applications as a', 'a.id', 'i.application_id')
          .select(['a.job_id', sql<string>`count(*)`.as('n')])
          .where('a.job_id', 'in', jobs.map((j) => j.id))
          .groupBy('a.job_id')
          .execute()
      : [];
    const all = await db
      .selectFrom('job_applications as a')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .select(['a.status', sql<string>`count(*)`.as('n')])
      .where('j.organisation_id', '=', org.id)
      .groupBy('a.status')
      .execute();
    const total = Object.fromEntries(all.map((r) => [r.status, Number(r.n)])) as Partial<Record<ApplicationStatus, number>>;
    return {
      asOf: new Date().toISOString(),
      verificationStatus: org.verification_status,
      totals: {
        openJobs: jobs.filter((j) => j.status === 'published').length,
        applicants: Object.values(total).reduce((s, n) => s + (n ?? 0), 0),
        shortlisted: total.shortlisted ?? 0,
        interviews: total.interview ?? 0,
        offers: total.offer ?? 0,
        joined: total.joined ?? 0,
      },
      jobs: jobs.map((j) => {
        const c = counts.get(j.id) ?? {};
        return {
          id: j.id,
          title: j.title,
          status: j.status,
          closingDate: j.closing_date,
          openings: j.openings,
          createdAt: iso(j.created_at),
          applicants: Object.values(c).reduce((s, n) => s + (n ?? 0), 0),
          shortlisted: c.shortlisted ?? 0,
          interviews: Number(interviews.find((i) => i.job_id === j.id)?.n ?? 0),
          offers: c.offer ?? 0,
          joined: c.joined ?? 0,
        };
      }),
    };
  });
};
