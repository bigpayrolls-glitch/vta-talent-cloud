import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { centreScope, isPlatformAdmin } from '../../policy/index.js';

/**
 * Dashboard counts for what exists so far: people, organisations, centres (Phase 1) and
 * courses, batches, enrolments and candidate verification (Phase 2). Hiring and assessment
 * counts arrive with their phases (AD-01 in full is H-01).
 */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/dashboard', { config: { permission: 'dashboard.read' } }, async (req) => {
    const actor = req.actor!;
    const asOf = new Date().toISOString();

    if (!isPlatformAdmin(actor)) {
      // Centre Admin: only their own centres for now.
      const scope = await centreScope(db, actor);
      const ids = scope === 'all' ? [] : scope;
      const rows = ids.length
        ? await db.selectFrom('batches').select(['status', sql<string>`count(*)`.as('n')]).where('centre_id', 'in', ids).groupBy('status').execute()
        : [];
      const b = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
      return { asOf, scope: 'centre', centres: { active: ids.length }, batches: { planned: b.planned ?? 0, active: b.active ?? 0, completed: b.completed ?? 0 } };
    }

    const roleCounts = await db
      .selectFrom('role_assignments as ra')
      .innerJoin('users as u', 'u.id', 'ra.user_id')
      .select(['ra.role', sql<string>`count(distinct ra.user_id)`.as('n')])
      .where('ra.revoked_at', 'is', null)
      .where('u.status', '=', 'active')
      .groupBy('ra.role')
      .execute();
    const byRole = Object.fromEntries(roleCounts.map((r) => [r.role, Number(r.n)]));

    const orgCounts = await db
      .selectFrom('organisations')
      .select(['type', 'verification_status', sql<string>`count(*)`.as('n')])
      .where('type', '!=', 'vta')
      .where('status', '=', 'active')
      .groupBy(['type', 'verification_status'])
      .execute();
    const orgs = (type: string, status?: string) =>
      orgCounts.filter((o) => o.type === type && (!status || o.verification_status === status)).reduce((s, o) => s + Number(o.n), 0);

    const userCounts = await db.selectFrom('users').select(['status', sql<string>`count(*)`.as('n')]).groupBy('status').execute();
    const users = Object.fromEntries(userCounts.map((r) => [r.status, Number(r.n)]));

    const centres = await db.selectFrom('centres').select(sql<string>`count(*)`.as('n')).where('status', '=', 'active').executeTakeFirstOrThrow();

    // Phase 2 training figures
    const courses = await db.selectFrom('courses').select(sql<string>`count(*)`.as('n')).where('status', '=', 'active').executeTakeFirstOrThrow();
    const batchRows = await db.selectFrom('batches').select(['status', sql<string>`count(*)`.as('n')]).groupBy('status').execute();
    const batches = Object.fromEntries(batchRows.map((r) => [r.status, Number(r.n)]));
    const enrolled = await db
      .selectFrom('enrolments as e')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .select(sql<string>`count(*)`.as('n'))
      .where('e.status', '=', 'enrolled')
      .where('b.status', 'in', ['planned', 'active'])
      .executeTakeFirstOrThrow();
    const candRows = await db.selectFrom('candidate_profiles').select(['verification_status', sql<string>`count(*)`.as('n')]).groupBy('verification_status').execute();
    const cand = Object.fromEntries(candRows.map((r) => [r.verification_status, Number(r.n)]));
    const dups = await db.selectFrom('candidate_profiles').select(sql<string>`count(*)`.as('n')).where('duplicate_of', 'is not', null).executeTakeFirstOrThrow();
    const trainersPending = await db.selectFrom('trainer_profiles').select(sql<string>`count(*)`.as('n')).where('verification_status', '=', 'pending').executeTakeFirstOrThrow();

    // Phase 6 hiring figures (AD-01). "Joined" counts only recorded joinings; VTA-verified ones are shown separately.
    const jobRows = await db.selectFrom('jobs').select(['status', sql<string>`count(*)`.as('n')]).groupBy('status').execute();
    const jobs = Object.fromEntries(jobRows.map((r) => [r.status, Number(r.n)]));
    const openJobs = await db.selectFrom('jobs').select(sql<string>`count(*)`.as('n')).where('status', '=', 'published').where('closing_date', '>=', sql<string>`(now() at time zone 'Asia/Kolkata')::date`).executeTakeFirstOrThrow();
    const appRows = await db.selectFrom('job_applications').select(['status', 'outcome_verification', sql<string>`count(*)`.as('n')]).groupBy(['status', 'outcome_verification']).execute();
    const apps = (status?: string, v?: string) => appRows.filter((r) => (!status || r.status === status) && (!v || r.outcome_verification === v)).reduce((a, r) => a + Number(r.n), 0);

    return {
      asOf,
      scope: 'platform',
      hiring: {
        openJobs: Number(openJobs.n),
        applications: apps(),
        joinedRecorded: apps('joined'),
        joinedVerified: apps('joined', 'verified'),
      },
      learners: { active: byRole.learner ?? 0 },
      trainers: { active: byRole.trainer ?? 0 },
      employers: { total: orgs('employer'), verified: orgs('employer', 'verified') },
      partners: { total: orgs('partner'), verified: orgs('partner', 'verified') },
      centres: { active: Number(centres.n) },
      users: {
        active: users.active ?? 0,
        invited: users.invited ?? 0,
        pending: users.pending ?? 0,
        suspended: users.suspended ?? 0,
      },
      training: {
        activeCourses: Number(courses.n),
        batchesPlanned: batches.planned ?? 0,
        batchesActive: batches.active ?? 0,
        batchesCompleted: batches.completed ?? 0,
        enrolledInOpenBatches: Number(enrolled.n),
        candidatesVerified: cand.verified ?? 0,
        candidatesTotal: Object.values(cand).reduce((a, b) => a + b, 0),
      },
      awaitingAction: {
        usersPendingApproval: users.pending ?? 0,
        organisationsPendingVerification: orgs('employer', 'pending') + orgs('partner', 'pending'),
        candidatesPendingVerification: (cand.pending ?? 0) + (cand.needs_correction ?? 0),
        possibleDuplicates: Number(dups.n),
        trainersPendingVerification: Number(trainersPending.n),
        jobsPendingReview: jobs.pending_review ?? 0,
        outcomesToVerify: apps('joined', 'unverified') + apps('not_joined', 'unverified'),
      },
    };
  });
};
