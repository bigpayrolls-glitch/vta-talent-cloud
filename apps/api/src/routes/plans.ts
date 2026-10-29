import { employerPlanEditSchema, PLAN_INFO, PLANS } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../app.js';
import { audit } from '../audit/service.js';
import { invalid } from '../lib/errors.js';
import { clearPlanCache, employerPlans } from '../lib/plans.js';
import { iso, parse } from '../lib/validate.js';

/**
 * Plans as AutoTalent Grid has set them. Anyone can read them (the plans pages); Admins change them in
 * Admin > Plans. Every change is in the audit log with the plan before and after.
 */
export const planRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.get('/plans', { config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => ({ employer: await employerPlans(db) }));

  app.get('/admin/plans', { config: { permission: 'subscription.manage' } }, async () => {
    const rows = await db.selectFrom('plan_catalogue as p').leftJoin('users as u', 'u.id', 'p.updated_by').select(['p.audience', 'p.code', 'p.updated_at', 'u.name']).execute();
    return {
      employer: await employerPlans(db),
      changed: rows.map((r) => ({ audience: r.audience, code: r.code, at: iso(r.updated_at), by: r.name })),
    };
  });

  app.put('/admin/plans/employer/:code', { config: { permission: 'subscription.manage' } }, async (req) => {
    const { code } = parse(z.object({ code: z.enum(PLANS) }), req.params);
    const b = parse(employerPlanEditSchema, req.body);
    if (code === 'free' && b.price && (b.price.monthly > 0 || b.price.yearly > 0)) throw invalid('The Free plan cannot have a price', { price: 'Free costs nothing' });
    if (code !== 'free' && code !== 'enterprise' && !b.price) throw invalid('Enter the monthly and yearly price', { price: 'Enter the prices' });
    const before = (await employerPlans(db))[code];
    // Rupees in, paise stored.
    const info = {
      ...b,
      price: b.price ? { monthly: b.price.monthly * 100, yearly: b.price.yearly * 100 } : null,
      ...(b.fromPrice !== undefined ? { fromPrice: b.fromPrice * 100 } : PLAN_INFO[code].fromPrice !== undefined ? { fromPrice: before.fromPrice } : {}),
    };
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('plan_catalogue')
        .values({ audience: 'employer', code, info: JSON.stringify(info), updated_by: req.actor!.userId })
        .onConflict((oc) => oc.columns(['audience', 'code']).doUpdateSet({ info: JSON.stringify(info), updated_by: req.actor!.userId, updated_at: new Date() }))
        .execute();
      await audit(trx, auditCtx(req), { action: 'plan.updated', entityType: 'plan', entityId: null, before: { audience: 'employer', code, ...before }, after: { audience: 'employer', code, ...info } });
    });
    clearPlanCache();
    return { employer: await employerPlans(db) };
  });
};
