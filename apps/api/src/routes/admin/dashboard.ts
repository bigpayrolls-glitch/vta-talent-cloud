import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { centreScope, isPlatformAdmin } from '../../policy/index.js';

/**
 * Phase 1 dashboard: counts of what exists in Phase 1 only (users, organisations, centres, approvals).
 * Training and hiring counts arrive with their phases (AD-01 in full is H-01).
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
      return { asOf, scope: 'centre', centres: { active: ids.length } };
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

    return {
      asOf,
      scope: 'platform',
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
      awaitingAction: {
        usersPendingApproval: users.pending ?? 0,
        organisationsPendingVerification: orgs('employer', 'pending') + orgs('partner', 'pending'),
      },
    };
  });
};
