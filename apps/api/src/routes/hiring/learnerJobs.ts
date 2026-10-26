import { ACTIVE_APPLICATION_STATUSES, applySchema, jobFilterSchema, NOTICE_VERSION, uuidSchema, type SkillArea } from '@vta/shared';
import { sql } from 'kysely';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { ApiError, conflict, invalid, notFound } from '../../lib/errors.js';
import { EMPLOYER_TEAM, notify, orgMembers } from '../../lib/notify.js';
import { iso, parse } from '../../lib/validate.js';
import { consentRequired } from '../learner/service.js';
import { certificatesOf, likeEscape, openJobsQuery, sharedDocumentsOf } from './common.js';

const idParam = z.object({ id: uuidSchema });

/** EE-07 to EE-09: learners find open jobs, apply with explicit sharing, and follow their applications. */
export const learnerJobRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const me = (req: FastifyRequest) => req.actor!.userId;
  const requireConsent = async (req: FastifyRequest) => {
    if (await consentRequired(db, me(req))) throw new ApiError('FORBIDDEN', 'Accept the privacy notice and terms of use first.');
  };

  const jobSelect = [
    'j.id',
    'j.title',
    'j.skill_area',
    'j.skills',
    'j.min_experience_months',
    'j.city',
    'j.location',
    'j.salary_min',
    'j.salary_max',
    'j.openings',
    'j.shift',
    'j.description',
    'j.closing_date',
    'j.vta_certificate_preferred',
    'j.published_at',
    'o.legal_name as employer',
    'o.city as employer_city',
  ] as const;
  interface JobRow {
    id: string;
    title: string;
    skill_area: string;
    skills: string[];
    min_experience_months: number;
    city: string;
    location: string | null;
    salary_min: number | null;
    salary_max: number | null;
    openings: number;
    shift: string | null;
    description: string;
    closing_date: string;
    vta_certificate_preferred: boolean;
    published_at: Date | null;
    employer: string;
  }
  const dto = (j: JobRow) => ({
    id: j.id,
    title: j.title,
    employer: j.employer,
    skillArea: j.skill_area,
    skills: j.skills,
    minExperienceMonths: j.min_experience_months,
    city: j.city,
    location: j.location,
    salaryMin: j.salary_min,
    salaryMax: j.salary_max,
    openings: j.openings,
    shift: j.shift,
    description: j.description,
    closingDate: j.closing_date,
    vtaCertificatePreferred: j.vta_certificate_preferred,
    publishedAt: iso(j.published_at),
  });

  app.get('/jobs', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const f = parse(jobFilterSchema, req.query);
    const mine = await myExpertise(me(req));
    let q = openJobsQuery(db);
    if (f.skillArea) q = q.where('j.skill_area', '=', f.skillArea);
    if (f.city) q = q.where('j.city', 'ilike', likeEscape(f.city));
    if (f.q) q = q.where((eb) => eb.or([eb('j.title', 'ilike', likeEscape(f.q!)), eb('o.legal_name', 'ilike', likeEscape(f.q!)), eb('j.description', 'ilike', likeEscape(f.q!))]));
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    // Jobs in the learner's own skill areas come first ("Recommended for your skills"); every open job stays visible.
    let list = q.select(jobSelect);
    if (mine.skillAreas.length) list = list.orderBy(sql`case when j.skill_area = any(${sql.val(mine.skillAreas)}::text[]) then 0 else 1 end`);
    const rows = await list.orderBy('j.published_at', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize).execute();
    const matchTotal = mine.skillAreas.length
      ? Number((await q.where('j.skill_area', 'in', mine.skillAreas as SkillArea[]).select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n)
      : 0;
    const applied = rows.length
      ? await db.selectFrom('job_applications').select(['job_id', 'id', 'status']).where('candidate_id', '=', me(req)).where('job_id', 'in', rows.map((r) => r.id)).execute()
      : [];
    const invites = await db
      .selectFrom('job_invitations as i')
      .innerJoin('jobs as j', 'j.id', 'i.job_id')
      .innerJoin('organisations as o', 'o.id', 'j.organisation_id')
      .select(['i.job_id', 'j.title', 'o.legal_name', 'i.message', 'i.created_at'])
      .where('i.candidate_id', '=', me(req))
      .where('j.status', '=', 'published')
      .orderBy('i.created_at', 'desc')
      .execute();
    const active = (jobId: string) => applied.find((a) => a.job_id === jobId && (ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(a.status));
    return {
      items: rows.map((r) => ({ ...dto(r), ...fit(r, mine), myApplicationId: active(r.id)?.id ?? null })),
      mySkillAreas: mine.skillAreas,
      myExperienceMonths: mine.experienceMonths,
      matchTotal,
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
      invitations: invites.map((i) => ({ jobId: i.job_id, title: i.title, employer: i.legal_name, message: i.message, at: iso(i.created_at) })),
    };
  });

  /** The learner's expertise from their profile: skill areas (2W, 4W, EV…) and experience. */
  const myExpertise = async (userId: string) => {
    const p = await db.selectFrom('candidate_profiles').select(['skill_areas', 'experience_months']).where('user_id', '=', userId).executeTakeFirst();
    return { skillAreas: (p?.skill_areas ?? []) as string[], experienceMonths: p?.experience_months ?? 0 };
  };
  /** How a job fits the learner. Information only: anyone may apply to any open job. */
  const fit = (j: { skill_area: string; min_experience_months: number }, m: { skillAreas: string[]; experienceMonths: number }) => ({
    matchesSkills: m.skillAreas.includes(j.skill_area),
    meetsExperience: m.experienceMonths >= j.min_experience_months,
  });

  const openJob = async (id: string) => {
    const j = await openJobsQuery(db).select(jobSelect).where('j.id', '=', id).executeTakeFirst();
    if (!j) throw notFound('Job');
    return j;
  };

  /** What would be shared with this employer if the person applies (shown before they confirm). */
  const sharePreview = async (userId: string) => {
    const p = await db
      .selectFrom('users as u')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
      .select(['u.name', 'u.phone', 'u.email', 'cp.city', 'cp.skill_areas', 'cp.experience_months', 'cp.verification_status'])
      .where('u.id', '=', userId)
      .executeTakeFirstOrThrow();
    return {
      fields: ['Name', 'Mobile number', ...(p.email ? ['Email'] : []), 'City and preferred work area', 'Skills, experience, education, languages and availability', 'Candidate ID and AutoTalent Grid verification status'],
      contact: { name: p.name, phone: p.phone, email: p.email },
      certificates: (await certificatesOf(db, userId)).map((c) => ({ id: c.id, course: c.course })),
      documents: (await sharedDocumentsOf(db, userId)).map((d) => ({ id: d.id, title: d.title })),
      verificationStatus: p.verification_status,
    };
  };

  app.get('/jobs/:id', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const j = await openJob(id);
    const existing = await db
      .selectFrom('job_applications')
      .select(['id', 'status'])
      .where('job_id', '=', id)
      .where('candidate_id', '=', me(req))
      .where('status', 'in', [...ACTIVE_APPLICATION_STATUSES])
      .executeTakeFirst();
    return { ...dto(j), ...fit(j, await myExpertise(me(req))), myApplicationId: existing?.id ?? null, share: await sharePreview(me(req)) };
  });

  /** EE-08: apply. The person confirms sharing; a snapshot of exactly what was shared is kept with the application. */
  app.post('/jobs/:id/apply', { config: { permission: 'learner.self' } }, async (req, reply) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const b = parse(applySchema, req.body);
    const j = await openJob(id);
    const userId = me(req);
    const already = await db
      .selectFrom('job_applications')
      .select('id')
      .where('job_id', '=', id)
      .where('candidate_id', '=', userId)
      .where('status', 'in', [...ACTIVE_APPLICATION_STATUSES])
      .executeTakeFirst();
    if (already) throw conflict('You have already applied to this job. See My applications.', { applicationId: already.id });
    const share = await sharePreview(userId);
    const snapshot = {
      sharedAt: new Date().toISOString(),
      noticeVersion: NOTICE_VERSION,
      employer: j.employer,
      job: j.title,
      fields: share.fields,
      certificates: share.certificates,
      documents: share.documents,
    };
    const appId = newId();
    try {
      await db.transaction().execute(async (trx) => {
        await trx.insertInto('job_applications').values({ id: appId, job_id: id, candidate_id: userId, consent_snapshot: JSON.stringify(snapshot), note: b.note ?? null }).execute();
        await trx.insertInto('application_events').values({ id: newId(), application_id: appId, from_status: null, to_status: 'applied', actor_id: userId, actor_kind: 'candidate' }).execute();
        await audit(trx, auditCtx(req), { action: 'application.submitted', entityType: 'application', entityId: appId, after: { jobId: id, shared: snapshot } });
        const { organisation_id } = await trx.selectFrom('jobs').select('organisation_id').where('id', '=', id).executeTakeFirstOrThrow();
        await notify(trx, await orgMembers(trx, organisation_id, EMPLOYER_TEAM), 'application_received', { job: j.title }, `/employer/applications/${appId}`);
      });
    } catch (e) {
      // Two taps at once: the database's one-active-application rule stops the second.
      if ((e as { code?: string }).code === '23505') throw conflict('You have already applied to this job. See My applications.');
      throw e;
    }
    reply.code(201);
    return { id: appId };
  });

  // ---- my applications (EE-09): status, timeline and interview times. Employer notes are never sent. ----

  app.get('/me/applications', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const rows = await db
      .selectFrom('job_applications as a')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .innerJoin('organisations as o', 'o.id', 'j.organisation_id')
      .select(['a.id', 'a.status', 'a.applied_at', 'a.updated_at', 'a.joining_date', 'j.id as job_id', 'j.title', 'j.city', 'o.legal_name'])
      .where('a.candidate_id', '=', me(req))
      .orderBy('a.applied_at', 'desc')
      .execute();
    return {
      items: rows.map((r) => ({ id: r.id, status: r.status, appliedAt: iso(r.applied_at), updatedAt: iso(r.updated_at), joiningDate: r.joining_date, job: { id: r.job_id, title: r.title, city: r.city, employer: r.legal_name } })),
    };
  });

  const myApplication = async (req: FastifyRequest, id: string) => {
    const a = await db
      .selectFrom('job_applications as a')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .innerJoin('organisations as o', 'o.id', 'j.organisation_id')
      .select(['a.id', 'a.status', 'a.applied_at', 'a.joining_date', 'a.consent_snapshot', 'a.note', 'j.id as job_id', 'j.title', 'j.city', 'o.legal_name'])
      .where('a.id', '=', id)
      .where('a.candidate_id', '=', me(req))
      .executeTakeFirst();
    if (!a) throw notFound('Application');
    return a;
  };

  app.get('/me/applications/:id', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const a = await myApplication(req, id);
    const events = await db.selectFrom('application_events').select(['id', 'to_status', 'created_at']).where('application_id', '=', id).orderBy('created_at').orderBy('id').execute();
    const interviews = await db
      .selectFrom('interviews')
      .select(['id', 'scheduled_at', 'mode', 'location', 'outcome'])
      .where('application_id', '=', id)
      .where('outcome', '!=', 'cancelled')
      .orderBy('scheduled_at')
      .execute();
    return {
      id: a.id,
      status: a.status,
      appliedAt: iso(a.applied_at),
      joiningDate: a.joining_date,
      note: a.note,
      job: { id: a.job_id, title: a.title, city: a.city, employer: a.legal_name },
      shared: a.consent_snapshot,
      timeline: events.map((e) => ({ id: e.id, status: e.to_status, at: iso(e.created_at) })),
      // Time, mode and place only. How it went and the employer's notes stay with the employer.
      interviews: interviews.map((i) => ({ id: i.id, scheduledAt: iso(i.scheduled_at), mode: i.mode, location: i.location })),
      canWithdraw: (ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(a.status),
    };
  });

  /** The person withdraws: the employer can no longer see their contact details or shared documents. */
  app.post('/me/applications/:id/withdraw', { config: { permission: 'learner.self' } }, async (req) => {
    await requireConsent(req);
    const { id } = parse(idParam, req.params);
    const a = await myApplication(req, id);
    if (!(ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(a.status)) throw invalid('This application is already finished.');
    await db.transaction().execute(async (trx) => {
      const done = await trx.updateTable('job_applications').set({ status: 'withdrawn', updated_at: new Date() }).where('id', '=', id).where('status', '=', a.status).returning('id').executeTakeFirst();
      if (!done) throw invalid('The employer just updated this application. Reload and try again.');
      await trx.insertInto('application_events').values({ id: newId(), application_id: id, from_status: a.status, to_status: 'withdrawn', actor_id: me(req), actor_kind: 'candidate' }).execute();
      await audit(trx, auditCtx(req), { action: 'application.withdrawn', entityType: 'application', entityId: id, before: { status: a.status }, after: { status: 'withdrawn' } });
      const { organisation_id } = await trx.selectFrom('jobs').select('organisation_id').where('id', '=', a.job_id).executeTakeFirstOrThrow();
      await notify(trx, await orgMembers(trx, organisation_id, EMPLOYER_TEAM), 'application_withdrawn', { job: a.title }, `/employer/jobs/${a.job_id}`);
    });
    return { ok: true };
  });
};
