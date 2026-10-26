import { PLAN_INFO, type Plan, type SubscriptionDto } from '@vta/shared';
import { sql } from 'kysely';
import type { DB } from '../db/index.js';
import type { EmployerSubscriptionsTable } from '../db/types.js';
import { ApiError } from './errors.js';
import type { Selectable } from 'kysely';

/**
 * Phase 12: the employer's plan and its limits. No subscription row, or one whose period has ended, means Free.
 * Limits are checked here so every route applies the same rules.
 */
type Row = Selectable<EmployerSubscriptionsTable>;

/** Jobs that count against the plan: waiting for review, live or paused. */
export const ACTIVE_JOB_STATUSES = ['pending_review', 'published', 'paused'] as const;

export async function currentSubscription(db: DB, organisationId: string, now = new Date()): Promise<{ plan: Plan; row: Row | null }> {
  const row = (await db.selectFrom('employer_subscriptions').selectAll().where('organisation_id', '=', organisationId).executeTakeFirst()) ?? null;
  const plan: Plan = row && row.period_end > now ? row.plan : 'free';
  return { plan, row };
}

export const planLimit = (message: string) => new ApiError('FORBIDDEN', message, { plan: 'upgrade' });

/** Sending a job for review or resuming it would make it active: refuse if the plan's active-job limit is reached. */
export async function assertActiveJobRoom(db: DB, organisationId: string, jobId: string): Promise<void> {
  const { plan } = await currentSubscription(db, organisationId);
  const limit = PLAN_INFO[plan].activeJobs;
  if (limit === null) return;
  const n = Number(
    (
      await db
        .selectFrom('jobs')
        .select(sql<string>`count(*)`.as('n'))
        .where('organisation_id', '=', organisationId)
        .where('status', 'in', ACTIVE_JOB_STATUSES)
        .where('id', '!=', jobId)
        .executeTakeFirstOrThrow()
    ).n,
  );
  if (n >= limit) {
    throw planLimit(
      `Your ${PLAN_INFO[plan].name} plan allows ${limit} active job${limit === 1 ? '' : 's'} at a time (waiting for review, live or paused). Close a job or upgrade your plan.`,
    );
  }
}

/**
 * Applications the employer cannot open on its plan: beyond the first N per job (Free) or the first N received
 * in a calendar month, India time (paid plans). Upgrading reveals them at once, because nothing is stored.
 */
export async function lockedApplicationIds(db: DB, organisationId: string, applicationIds?: string[]): Promise<Set<string>> {
  if (applicationIds && !applicationIds.length) return new Set();
  const { plan } = await currentSubscription(db, organisationId);
  const rule = PLAN_INFO[plan].applicants;
  if (!rule) return new Set();
  const partition = rule.per === 'job' ? sql`a.job_id` : sql`date_trunc('month', a.applied_at AT TIME ZONE 'Asia/Kolkata')`;
  const ranked = db
    .selectFrom('job_applications as a')
    .innerJoin('jobs as j', 'j.id', 'a.job_id')
    .select(['a.id', sql<string>`row_number() OVER (PARTITION BY ${partition} ORDER BY a.applied_at, a.id)`.as('rank')])
    .where('j.organisation_id', '=', organisationId);
  let q = db.selectFrom(ranked.as('r')).select('r.id').where(sql`r.rank`, '>', rule.limit);
  if (applicationIds) q = q.where('r.id', 'in', applicationIds);
  return new Set((await q.execute()).map((r) => r.id));
}

export async function assertApplicationOpen(db: DB, organisationId: string, applicationId: string): Promise<void> {
  if ((await lockedApplicationIds(db, organisationId, [applicationId])).has(applicationId)) {
    const { plan } = await currentSubscription(db, organisationId);
    const rule = PLAN_INFO[plan].applicants!;
    throw planLimit(`Your ${PLAN_INFO[plan].name} plan shows ${rule.limit} applicants ${rule.per === 'job' ? 'per job' : 'a month'}. Upgrade your plan to open this applicant.`);
  }
}

export async function assertFeature(db: DB, organisationId: string, feature: 'interviews' | 'contactDetails'): Promise<void> {
  const { plan } = await currentSubscription(db, organisationId);
  if (!PLAN_INFO[plan][feature]) {
    throw planLimit(feature === 'interviews' ? 'Interview management is part of the Starter plan and above. Upgrade your plan to schedule interviews.' : 'Upgrade your plan to see contact details.');
  }
}

/** First day of next month in India, as YYYY-MM-DD. */
function nextMonthStartIst(now: Date): string {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  return new Date(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1)).toISOString().slice(0, 10);
}

export async function subscriptionDto(db: DB, organisationId: string, paymentMode: 'test' | 'none', now = new Date()): Promise<SubscriptionDto> {
  const { plan, row } = await currentSubscription(db, organisationId, now);
  const info = PLAN_INFO[plan];
  const count = async (q: { executeTakeFirstOrThrow(): Promise<{ n: string }> }) => Number((await q.executeTakeFirstOrThrow()).n);
  const activeJobs = await count(
    db.selectFrom('jobs').select(sql<string>`count(*)`.as('n')).where('organisation_id', '=', organisationId).where('status', 'in', ACTIVE_JOB_STATUSES),
  );
  let applicants = 0;
  if (info.applicants?.per === 'job') {
    const r = await db
      .selectFrom('job_applications as a')
      .innerJoin('jobs as j', 'j.id', 'a.job_id')
      .select(sql<string>`count(*)`.as('n'))
      .where('j.organisation_id', '=', organisationId)
      .groupBy('a.job_id')
      .orderBy(sql`count(*)`, 'desc')
      .limit(1)
      .executeTakeFirst();
    applicants = Number(r?.n ?? 0);
  } else {
    applicants = await count(
      db
        .selectFrom('job_applications as a')
        .innerJoin('jobs as j', 'j.id', 'a.job_id')
        .select(sql<string>`count(*)`.as('n'))
        .where('j.organisation_id', '=', organisationId)
        .where(sql<boolean>`date_trunc('month', a.applied_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', ${now}::timestamptz AT TIME ZONE 'Asia/Kolkata')`),
    );
  }
  const teamMembers = await count(
    db
      .selectFrom('role_assignments as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(sql<string>`count(DISTINCT r.user_id)`.as('n'))
      .where('r.organisation_id', '=', organisationId)
      .where('r.role', 'in', ['employer_admin', 'employer_recruiter'])
      .where('r.revoked_at', 'is', null)
      .where('u.status', 'in', ['active', 'invited']),
  );
  return {
    plan,
    lastPaidPlan: row?.plan ?? null,
    cycle: plan === 'free' ? null : (row?.billing_cycle ?? null),
    status: plan !== 'free' ? 'active' : row ? 'expired' : 'free',
    periodEnd: row ? row.period_end.toISOString() : null,
    source: row?.source ?? null,
    usage: {
      activeJobs,
      activeJobsLimit: info.activeJobs,
      applicants,
      applicantsLimit: info.applicants?.limit ?? null,
      applicantsPer: info.applicants?.per ?? null,
      teamMembers,
      resetsOn: nextMonthStartIst(now),
    },
    paymentMode,
  };
}

/** A month or a year after `from`, on the same day of the month where it exists. */
export function addPeriod(from: Date, cycle: 'monthly' | 'yearly', count = 1): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (cycle === 'monthly') d.setUTCMonth(d.getUTCMonth() + count);
  else d.setUTCFullYear(d.getUTCFullYear() + count);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
