import { candidateSearchSchema, inviteToApplySchema, maskedName, PLAN_INFO, uuidSchema, type SearchUsageDto } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { notify } from '../../lib/notify.js';
import { newId } from '../../lib/crypto.js';
import { ApiError, conflict, invalid, notFound } from '../../lib/errors.js';
import { currentSubscription } from '../../lib/subscriptions.js';
import { iso, parse } from '../../lib/validate.js';
import { assertVerified, certificatesOf, employerOrg, likeEscape, openJobsQuery, sharedDocumentsOf } from './common.js';

const idParam = z.object({ id: uuidSchema });

/** The calendar month in India time: "2026-10", its first moment, and the first day of the next month. */
export function istMonth(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - 5.5 * 3600_000);
  const next = new Date(Date.UTC(y, m + 1, 1));
  return { period: `${y}-${String(m + 1).padStart(2, '0')}`, start, resetsOn: next.toISOString().slice(0, 10) };
}

/** A plan limit reached: the screen shows an upgrade message (fields.plan = 'limit'). */
const limitReached = (message: string) => new ApiError('FORBIDDEN', message, { plan: 'limit' });

/**
 * EM-04 / EM-05 / EM-10: verified employers search candidates whose profile is findable (see `searchable`). Results never include phone, email, date of birth or
 * the full surname; those are shared only when the person applies. Opening a profile is logged.
 */
export const searchRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /**
   * 29 Oct 2026 (decision of AutoTalent Grid): candidates show while AutoTalent Grid has not yet checked them
   * (marked "Not verified yet"), and imported candidates show before they first sign in. Each person can still
   * turn "Employers can find my profile" off. Rejected or closed accounts never show.
   */
  const searchable = () =>
    db
      .selectFrom('candidate_profiles as cp')
      .innerJoin('users as u', 'u.id', 'cp.user_id')
      .where('cp.searchable', '=', true)
      .where('cp.verification_status', 'in', ['verified', 'pending'])
      .where('u.status', 'in', ['active', 'invited']);

  /** What this employer has used of its plan's candidate search this month. */
  async function usage(orgId: string): Promise<SearchUsageDto> {
    const { plan } = await currentSubscription(db, orgId);
    const lim = PLAN_INFO[plan].search;
    const m = istMonth();
    const views = await db.selectFrom('candidate_profile_views').select((eb) => eb.fn.countAll<string>().as('n')).where('organisation_id', '=', orgId).where('period', '=', m.period).executeTakeFirstOrThrow();
    const invites = await db
      .selectFrom('job_invitations as i')
      .innerJoin('jobs as j', 'j.id', 'i.job_id')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('j.organisation_id', '=', orgId)
      .where('i.created_at', '>=', m.start)
      .executeTakeFirstOrThrow();
    return {
      plan,
      resetsOn: m.resetsOn,
      results: lim.results,
      allFilters: lim.allFilters,
      profileViews: { used: Number(views.n), limit: lim.profileViews },
      invites: { used: Number(invites.n), limit: lim.invites },
    };
  }

  app.get('/employer/candidates/usage', { config: { permission: 'candidate.search' } }, async (req) => usage((await employerOrg(db, req)).id));

  app.get('/employer/candidates', { config: { permission: 'candidate.search' } }, async (req) => {
    const org = await employerOrg(db, req);
    assertVerified(org);
    const f = parse(candidateSearchSchema, req.query);
    const lim = PLAN_INFO[(await currentSubscription(db, org.id)).plan].search;
    if (!lim.allFilters && (f.minExperienceMonths !== undefined || f.hasCertificate || f.courseId || f.availability)) {
      throw limitReached('Experience and certificate filters are in the Starter plan and above.');
    }
    let q = searchable();
    if (f.skillArea) q = q.where(sql<boolean>`${f.skillArea} = any(cp.skill_areas)`);
    if (f.city) q = q.where((eb) => eb.or([eb('cp.city', 'ilike', likeEscape(f.city!)), eb('cp.preferred_work_area', 'ilike', likeEscape(f.city!))]));
    if (f.minExperienceMonths !== undefined) q = q.where('cp.experience_months', '>=', f.minExperienceMonths);
    if (f.availability) q = q.where('cp.availability', 'ilike', likeEscape(f.availability));
    if (f.hasCertificate === 'yes' || f.courseId) {
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('credentials as c')
            .select('c.id')
            .whereRef('c.candidate_id', '=', 'cp.user_id')
            .where('c.status', '=', 'active')
            .$if(!!f.courseId, (s) => s.where('c.course_id', '=', f.courseId!)),
        ),
      );
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select([
        'cp.user_id',
        'u.name',
        'cp.city',
        'cp.preferred_work_area',
        'cp.skill_areas',
        'cp.experience_months',
        'cp.languages',
        'cp.availability',
        'cp.verification_status',
        sql<string[]>`array(select c.course_title from credentials c where c.candidate_id = cp.user_id and c.status = 'active' order by c.issue_date desc)`.as('certs'),
      ])
      .orderBy('cp.experience_months', 'desc')
      .orderBy('cp.user_id')
      // Free plan: only the first `results` candidates of a search are shown.
      .limit(lim.results === null ? f.pageSize : Math.max(0, Math.min(f.pageSize, lim.results - (f.page - 1) * f.pageSize)))
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.user_id,
        name: maskedName(r.name),
        city: r.city,
        preferredWorkArea: r.preferred_work_area,
        skillAreas: r.skill_areas,
        experienceMonths: r.experience_months,
        languages: r.languages,
        availability: r.availability,
        verified: r.verification_status === 'verified',
        vtaCertificates: r.certs,
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: lim.results === null ? Number(total) : Math.min(Number(total), lim.results),
      // Plans that cap results do not see how many matched in all, only whether more do.
      matched: lim.results === null ? Number(total) : null,
      more: lim.results !== null && Number(total) > lim.results,
      limitedTo: lim.results,
    };
  });

  app.get('/employer/candidates/:id', { config: { permission: 'candidate.search' } }, async (req) => {
    const org = await employerOrg(db, req);
    assertVerified(org);
    const { id } = parse(idParam, req.params);
    const p = await searchable()
      .select(['cp.user_id', 'u.name', 'u.phone', 'u.email', 'cp.city', 'cp.state', 'cp.preferred_work_area', 'cp.skill_areas', 'cp.experience_months', 'cp.education', 'cp.languages', 'cp.availability', 'cp.willing_to_relocate', 'cp.verification_status'])
      .where('cp.user_id', '=', id)
      .executeTakeFirst();
    if (!p) throw notFound('Candidate');
    // Plan limit: each candidate counts once a month; opening them again is free.
    const m = istMonth();
    const seen = await db.selectFrom('candidate_profile_views').select('candidate_id').where('organisation_id', '=', org.id).where('period', '=', m.period).where('candidate_id', '=', id).executeTakeFirst();
    if (!seen) {
      const u = await usage(org.id);
      if (u.profileViews.limit !== null && u.profileViews.used >= u.profileViews.limit) {
        throw limitReached(`You have opened ${u.profileViews.limit} candidate profiles this month, the limit of your ${PLAN_INFO[u.plan].name} plan. Upgrade to see more, or wait until ${u.resetsOn}.`);
      }
      await db.insertInto('candidate_profile_views').values({ organisation_id: org.id, candidate_id: id, period: m.period, viewed_by: req.actor!.userId }).onConflict((oc) => oc.doNothing()).execute();
    }
    await audit(db, auditCtx(req), { action: 'candidate.profile_viewed', entityType: 'user', entityId: id, after: { organisationId: org.id, via: 'search' } });
    // Contact details come with the plan ("View candidate contact details": Starter and above). Each reveal is logged.
    const contactOnPlan = PLAN_INFO[(await currentSubscription(db, org.id)).plan].contactDetails;
    if (contactOnPlan) {
      await audit(db, auditCtx(req), { action: 'candidate.contact_viewed', entityType: 'user', entityId: id, after: { organisationId: org.id, via: 'search' } });
    }
    const invited = await db
      .selectFrom('job_invitations as i')
      .innerJoin('jobs as j', 'j.id', 'i.job_id')
      .select(['i.job_id', 'j.title', 'i.created_at'])
      .where('i.candidate_id', '=', id)
      .where('j.organisation_id', '=', org.id)
      .execute();
    return {
      id: p.user_id,
      name: contactOnPlan ? p.name : maskedName(p.name),
      city: p.city,
      state: p.state,
      preferredWorkArea: p.preferred_work_area,
      skillAreas: p.skill_areas,
      experienceMonths: p.experience_months,
      education: p.education,
      languages: p.languages,
      availability: p.availability,
      willingToRelocate: p.willing_to_relocate,
      verified: p.verification_status === 'verified',
      certificates: await certificatesOf(db, id),
      // Titles only. Files open once the person applies to one of your jobs.
      documents: (await sharedDocumentsOf(db, id)).map(({ id: docId, kind, title, verificationStatus }) => ({ id: docId, kind, title, verificationStatus })),
      contact: 'Shared when they apply to one of your jobs',
      phone: contactOnPlan ? p.phone : null,
      email: contactOnPlan ? p.email : null,
      contactNeedsUpgrade: !contactOnPlan,
      invitations: invited.map((i) => ({ jobId: i.job_id, title: i.title, at: iso(i.created_at) })),
    };
  });

  /** Invites a searchable candidate to apply to one of this employer's open jobs. The learner decides. */
  app.post('/employer/candidates/:id/invite', { config: { permission: 'candidate.search' } }, async (req, reply) => {
    const org = await employerOrg(db, req);
    assertVerified(org);
    const { id } = parse(idParam, req.params);
    const b = parse(inviteToApplySchema, req.body);
    const cand = await searchable().select('cp.user_id').where('cp.user_id', '=', id).executeTakeFirst();
    if (!cand) throw notFound('Candidate');
    const job = await openJobsQuery(db).select('j.id').where('j.id', '=', b.jobId).where('j.organisation_id', '=', org.id).executeTakeFirst();
    if (!job) throw invalid('Choose one of your open, published jobs', { jobId: 'Not an open job of yours' });
    const existing = await db.selectFrom('job_invitations').select('id').where('job_id', '=', b.jobId).where('candidate_id', '=', id).executeTakeFirst();
    if (existing) throw conflict('You already invited this person to this job');
    const u = await usage(org.id);
    if (u.invites.limit !== null && u.invites.used >= u.invites.limit) {
      throw limitReached(`You have sent ${u.invites.limit} invitations this month, the limit of your ${PLAN_INFO[u.plan].name} plan. Upgrade to send more, or wait until ${u.resetsOn}.`);
    }
    const iid = newId();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('job_invitations').values({ id: iid, job_id: b.jobId, candidate_id: id, invited_by: req.actor!.userId, message: b.message ?? null }).execute();
      await audit(trx, auditCtx(req), { action: 'candidate.invited_to_apply', entityType: 'user', entityId: id, after: { jobId: b.jobId, organisationId: org.id } });
      const { title } = await trx.selectFrom('jobs').select('title').where('id', '=', b.jobId).executeTakeFirstOrThrow();
      await notify(trx, [id], 'job_invitation', { job: title, company: org.legal_name }, `/learn/jobs/${b.jobId}`);
    });
    reply.code(201);
    return { id: iid };
  });
};
