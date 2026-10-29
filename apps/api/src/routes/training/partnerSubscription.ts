import { partnerCheckoutSchema, partnerPlanTotal, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { partnerSubscriptionDto } from '../../lib/partnerSubscriptions.js';
import { startRazorpayOrder } from '../../lib/payments.js';
import { partnerPlan } from '../../lib/plans.js';
import { iso, parse } from '../../lib/validate.js';
import { partnerOrgs } from '../../policy/index.js';
import { activatePlan } from '../hiring/subscription.js';

const idParam = z.object({ id: uuidSchema });

/** The training partner organisation the signed-in partner admin manages. */
function partnerOrgId(req: FastifyRequest): string {
  const id = partnerOrgs(req.actor!)[0];
  if (!id) throw notFound('Training partner');
  return id;
}

/**
 * Training partner Subscription & Billing (29 Oct 2026): plan, usage, checkout (GST added) and invoices.
 * Same payment flow as employers: test payments on staging, Razorpay on the live site.
 */
export const partnerSubscriptionRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const mode = app.config.paymentMode;

  app.get('/partner/subscription', { config: { permission: 'partner.subscription' } }, async (req) => partnerSubscriptionDto(db, partnerOrgId(req), mode));

  const paymentDto = (p: { id: string; plan: string; billing_cycle: string; amount_paise: number; gst_paise: number; method: string; provider: string; invoice_number: string; period_start: Date; period_end: Date; created_at: Date }) => ({
    id: p.id,
    plan: p.plan,
    cycle: p.billing_cycle,
    amountPaise: p.amount_paise,
    gstPaise: p.gst_paise,
    method: p.method,
    test: p.provider === 'test',
    invoiceNumber: p.invoice_number,
    periodStart: iso(p.period_start),
    periodEnd: iso(p.period_end),
    paidAt: iso(p.created_at),
  });

  app.get('/partner/subscription/payments', { config: { permission: 'partner.subscription' } }, async (req) => {
    const rows = await db.selectFrom('subscription_payments').selectAll().where('organisation_id', '=', partnerOrgId(req)).orderBy('created_at', 'desc').limit(100).execute();
    return { items: rows.map(paymentDto) };
  });

  app.get('/partner/subscription/payments/:id', { config: { permission: 'partner.subscription' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const p = await db
      .selectFrom('subscription_payments as p')
      .innerJoin('organisations as o', 'o.id', 'p.organisation_id')
      .innerJoin('users as u', 'u.id', 'p.paid_by')
      .selectAll('p')
      .select(['o.legal_name', 'o.city', 'o.contact_email', 'u.name as paid_by_name'])
      .where('p.id', '=', id)
      .where('p.organisation_id', '=', partnerOrgId(req))
      .executeTakeFirst();
    if (!p) throw notFound('Invoice');
    return { ...paymentDto(p), company: { name: p.legal_name, city: p.city, email: p.contact_email }, paidByName: p.paid_by_name };
  });

  /** Buy or renew a plan: the price plus GST. The plan starts when the payment is confirmed. */
  app.post('/partner/subscription/checkout', { config: { permission: 'partner.subscription' } }, async (req, reply) => {
    const b = parse(partnerCheckoutSchema, req.body);
    if (mode === 'none') throw conflict('Online payment is not set up yet. Ask AutoTalent Grid to set up your plan.');
    if (mode === 'test' && !b.method) throw invalid('Choose how to pay', { method: 'Choose how to pay' });
    const orgId = partnerOrgId(req);
    const info = await partnerPlan(db, b.plan);
    const { gst, total } = partnerPlanTotal(info, b.cycle);
    if (total <= 0) throw conflict('This plan has no price for that billing period. Ask AutoTalent Grid about it.');
    reply.code(201);
    if (mode === 'razorpay') {
      const payer = await db.selectFrom('users').select(['name', 'email', 'phone']).where('id', '=', req.actor!.userId).executeTakeFirstOrThrow();
      return startRazorpayOrder(app, {
        purpose: 'plan',
        amountPaise: total,
        gstPaise: gst,
        payerId: req.actor!.userId,
        organisationId: orgId,
        plan: b.plan,
        cycle: b.cycle,
        description: `${info.name} plan, ${b.cycle}`,
        prefill: { name: payer.name, email: payer.email ?? undefined, contact: payer.phone ?? undefined },
        ctx: auditCtx(req),
      });
    }
    return db.transaction().execute((trx) =>
      activatePlan(trx, auditCtx(req), { organisationId: orgId, plan: b.plan, cycle: b.cycle, amountPaise: total, gstPaise: gst, method: b.method!, provider: 'test', paidBy: req.actor!.userId }),
    );
  });
};
