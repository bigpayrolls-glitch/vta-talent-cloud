import { PARTNER_PLANS, type PartnerPlan, type PartnerSubscriptionDto } from '@vta/shared';
import { sql } from 'kysely';
import type { DB } from '../db/index.js';
import { partnerPlan } from './plans.js';
import { planLimit } from './subscriptions.js';

/**
 * Training partner plans (29 Oct 2026). A partner's current plan is its subscription row while it lasts, else
 * Free. Limits: active courses (submitted, needing changes or published, and switched on), active batches
 * (planned or running, at the partner's centres) and current learners (enrolled in those batches).
 */
const isPartnerPlan = (p: string): p is PartnerPlan => (PARTNER_PLANS as readonly string[]).includes(p);

export async function currentPartnerPlan(db: DB, organisationId: string, now = new Date()) {
  const row = (await db.selectFrom('employer_subscriptions').selectAll().where('organisation_id', '=', organisationId).executeTakeFirst()) ?? null;
  const plan: PartnerPlan = row && row.period_end > now && isPartnerPlan(row.plan) ? row.plan : 'free';
  return { plan, row };
}

const n = async (q: { executeTakeFirstOrThrow(): Promise<{ n: string }> }) => Number((await q.executeTakeFirstOrThrow()).n);

export async function partnerUsage(db: DB, organisationId: string, except: { courseId?: string } = {}) {
  const activeCourses = await n(
    db
      .selectFrom('courses')
      .select(sql<string>`count(*)`.as('n'))
      .where('owner_organisation_id', '=', organisationId)
      .where('status', '=', 'active')
      .where('approval_status', 'in', ['submitted', 'changes_requested', 'published'])
      .$if(!!except.courseId, (q) => q.where('id', '!=', except.courseId!)),
  );
  const batches = () =>
    db.selectFrom('batches as b').innerJoin('centres as c', 'c.id', 'b.centre_id').where('c.organisation_id', '=', organisationId).where('b.status', 'in', ['planned', 'active']);
  const activeBatches = await n(batches().select(sql<string>`count(*)`.as('n')));
  const learners = await n(
    batches()
      .innerJoin('enrolments as e', 'e.batch_id', 'b.id')
      .where('e.status', '!=', 'withdrawn')
      .select(sql<string>`count(DISTINCT e.candidate_id)`.as('n')),
  );
  return { activeCourses, activeBatches, learners };
}

export async function partnerSubscriptionDto(db: DB, organisationId: string, paymentMode: 'test' | 'none' | 'razorpay'): Promise<PartnerSubscriptionDto> {
  const { plan, row } = await currentPartnerPlan(db, organisationId);
  const info = await partnerPlan(db, plan);
  const u = await partnerUsage(db, organisationId);
  return {
    plan,
    lastPaidPlan: row && isPartnerPlan(row.plan) ? row.plan : null,
    cycle: plan === 'free' ? null : (row?.billing_cycle ?? null),
    status: plan !== 'free' ? 'active' : row ? 'expired' : 'free',
    periodEnd: row ? row.period_end.toISOString() : null,
    source: row?.source ?? null,
    usage: {
      activeCourses: u.activeCourses,
      activeCoursesLimit: info.activeCourses,
      activeBatches: u.activeBatches,
      activeBatchesLimit: info.activeBatches,
      learners: u.learners,
      learnersLimit: info.learners,
    },
    paymentMode,
  };
}

const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** Submitting a course makes it active: refused when the plan's active-course limit is reached. */
export async function assertCourseRoom(db: DB, organisationId: string, courseId: string): Promise<void> {
  const { plan } = await currentPartnerPlan(db, organisationId);
  const info = await partnerPlan(db, plan);
  if (info.activeCourses === null) return;
  const u = await partnerUsage(db, organisationId, { courseId });
  if (u.activeCourses >= info.activeCourses) {
    throw planLimit(`Your ${info.name} plan allows ${plural(info.activeCourses, 'active course', 'active courses')}. Switch off a course or upgrade your plan in Subscription & Billing.`);
  }
}

/** A new batch: refused when the plan's active-batch limit is reached. */
export async function assertBatchRoom(db: DB, organisationId: string): Promise<void> {
  const { plan } = await currentPartnerPlan(db, organisationId);
  const info = await partnerPlan(db, plan);
  if (info.activeBatches === null) return;
  const u = await partnerUsage(db, organisationId);
  if (u.activeBatches >= info.activeBatches) {
    throw planLimit(`Your ${info.name} plan allows ${plural(info.activeBatches, 'active batch', 'active batches')}. Finish or cancel a batch, or upgrade your plan in Subscription & Billing.`);
  }
}

/** Adding learners: refused when they would take the partner past the plan's learner limit. */
export async function assertLearnerRoom(db: DB, organisationId: string, adding: number): Promise<void> {
  const { plan } = await currentPartnerPlan(db, organisationId);
  const info = await partnerPlan(db, plan);
  if (info.learners === null) return;
  const u = await partnerUsage(db, organisationId);
  if (u.learners + adding > info.learners) {
    throw planLimit(`Your ${info.name} plan allows up to ${plural(info.learners, 'learner', 'learners')} in current batches (now ${u.learners}). Upgrade your plan in Subscription & Billing.`);
  }
}

/** For self-enrolment: whether a partner's plan has room for one more learner (a reason when not). */
export async function partnerLearnerBlocker(db: DB, organisationId: string): Promise<string | null> {
  try {
    await assertLearnerRoom(db, organisationId, 1);
    return null;
  } catch {
    return 'This training centre cannot take more learners right now. Choose another batch, or try again later.';
  }
}
