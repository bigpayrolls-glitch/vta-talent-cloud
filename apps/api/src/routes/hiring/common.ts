import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { DB } from '../../db/index.js';
import type { Job, Organisation } from '../../db/types.js';
import { ApiError, forbidden, notFound } from '../../lib/errors.js';
import { todayIst } from '../../lib/dates.js';
import { iso } from '../../lib/validate.js';

/**
 * Employers see and change only their own organisation's records. The organisation comes from the
 * actor's employer role, never from the request, so changing an id in a URL or body cannot reach
 * another employer: anything outside is "not found" (SEC-02).
 */
export function employerOrgId(req: FastifyRequest): string {
  const a = req.actor!.assignments.find((x) => (x.role === 'employer_admin' || x.role === 'employer_recruiter') && x.organisationId);
  if (!a?.organisationId) throw forbidden('This account is not linked to an employer.');
  return a.organisationId;
}

export async function employerOrg(db: DB, req: FastifyRequest): Promise<Organisation> {
  const org = await db.selectFrom('organisations').selectAll().where('id', '=', employerOrgId(req)).executeTakeFirst();
  if (!org) throw notFound('Organisation');
  return org;
}

/** EM-01: an employer can post jobs and search candidates only once VTA has verified it. */
export function assertVerified(org: Organisation): void {
  if (org.status !== 'active') throw new ApiError('FORBIDDEN', 'This employer account is inactive. Contact AutoTalent Grid.');
  if (org.verification_status !== 'verified') {
    throw new ApiError('FORBIDDEN', 'AutoTalent Grid needs to verify your company first. Complete your company profile and send it for checking.');
  }
}

export async function ownJob(db: DB, req: FastifyRequest, id: string): Promise<Job> {
  const job = await db.selectFrom('jobs').selectAll().where('id', '=', id).where('organisation_id', '=', employerOrgId(req)).executeTakeFirst();
  if (!job) throw notFound('Job');
  return job;
}

/** Open to learners: published, not past its closing date, from an active verified employer. */
export function openJobsQuery(db: DB) {
  return db
    .selectFrom('jobs as j')
    .innerJoin('organisations as o', 'o.id', 'j.organisation_id')
    .where('j.status', '=', 'published')
    .where('j.closing_date', '>=', todayIst())
    .where('o.verification_status', '=', 'verified')
    .where('o.status', '=', 'active');
}

export function jobDto(j: Job, extra: Record<string, unknown> = {}) {
  return {
    id: j.id,
    title: j.title,
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
    status: j.status,
    publishedAt: iso(j.published_at),
    createdAt: iso(j.created_at),
    ...extra,
  };
}

/** The learner's VTA certificates as an employer may see them (no internal reasons). */
export async function certificatesOf(db: DB, candidateId: string) {
  const rows = await db
    .selectFrom('credentials')
    .select(['id', 'course_title', 'issue_date', 'status', 'verification_code'])
    .where('candidate_id', '=', candidateId)
    .where('status', '=', 'active')
    .orderBy('issue_date', 'desc')
    .execute();
  return rows.map((c) => ({ id: c.id, course: c.course_title, issueDate: c.issue_date, status: c.status, verifyPath: `/verify/${c.verification_code}` }));
}

/** Documents the learner marked as visible to employers (titles and status only). */
export async function sharedDocumentsOf(db: DB, candidateId: string) {
  const rows = await db
    .selectFrom('documents')
    .select(['id', 'kind', 'title', 'verification_status', 'created_at'])
    .where('owner_user_id', '=', candidateId)
    .where('organisation_id', 'is', null)
    .where('visibility', '=', 'employers')
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((d) => ({ id: d.id, kind: d.kind, title: d.title, verificationStatus: d.verification_status }));
}

export const countBy = <K extends string>(rows: { k: K; n: string | number }[]) => Object.fromEntries(rows.map((r) => [r.k, Number(r.n)])) as Partial<Record<K, number>>;

export const likeEscape = (s: string) => `%${s.replace(/[%_\\]/g, '\\$&')}%`;

export { sql };
