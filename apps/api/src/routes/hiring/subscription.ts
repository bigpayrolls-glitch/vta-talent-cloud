import { adminSetPlanSchema, checkoutSchema, PARTNER_PLANS, planRequestSchema, PLANS, uuidSchema, type PaidPartnerPlan, type PartnerPlan, type Plan } from '@vta/shared';
import { currentPartnerPlan, partnerSubscriptionDto } from '../../lib/partnerSubscriptions.js';
import { employerPlan, partnerPlan } from '../../lib/plans.js';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit, type AuditContext } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import { startRazorpayOrder } from '../../lib/payments.js';
import { newId } from '../../lib/crypto.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { EMPLOYER_TEAM, notify, orgMembers, vtaReviewers } from '../../lib/notify.js';
import { addPeriod, currentSubscription, subscriptionDto } from '../../lib/subscriptions.js';
import { iso, parse } from '../../lib/validate.js';
import { assertVerified, employerOrg, employerOrgId } from './common.js';

const idParam = z.object({ id: uuidSchema });

/** "30 Nov 2026" in India time. */
const istDay = (d: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);

/**
 * Starts or extends a paid plan and records the payment with its invoice number, inside the caller's transaction.
 * Paying for the plan you already have extends it from its end date; a different plan starts now (no refund or
 * credit for the old one: shown before paying). Used by test payments and verified Razorpay payments.
 */
export async function activatePlan(
  trx: DB,
  ctx: AuditContext,
  p: {
    organisationId: string;
    plan: 'starter' | 'growth' | 'professional' | 'institution';
    cycle: 'monthly' | 'yearly';
    /** Total paid, GST included. */
    amountPaise: number;
    gstPaise?: number;
    method: 'card' | 'upi' | 'netbanking' | 'wallet' | 'other';
    provider: 'test' | 'razorpay';
    providerPaymentId?: string;
    paidBy: string;
  },
): Promise<{ paymentId: string; invoiceNumber: string }> {
  // Lock the subscription row so two payments for one organisation are applied one after the other.
  await sql`SELECT 1 FROM employer_subscriptions WHERE organisation_id = ${p.organisationId} FOR UPDATE`.execute(trx);
  const now = new Date();
  const org = await trx.selectFrom('organisations').select('type').where('id', '=', p.organisationId).executeTakeFirstOrThrow();
  const partner = org.type === 'partner';
  const { plan: current, row } = partner ? await currentPartnerPlan(trx, p.organisationId, now) : await currentSubscription(trx, p.organisationId, now);
  const start = current === p.plan && row && row.billing_cycle === p.cycle ? row.period_end : now;
  const end = addPeriod(start, p.cycle);
  const id = newId();
  const seq = (await sql<{ n: string }>`SELECT nextval('invoice_number_seq') AS n`.execute(trx)).rows[0]!.n;
  const day = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
  const invoice = `INV-${day}-${String(seq).padStart(4, '0')}`;
  await trx
    .insertInto('subscription_payments')
    .values({ id, organisation_id: p.organisationId, plan: p.plan, billing_cycle: p.cycle, amount_paise: p.amountPaise, gst_paise: p.gstPaise ?? 0, method: p.method, provider: p.provider, provider_payment_id: p.providerPaymentId ?? null, status: 'succeeded', invoice_number: invoice, period_start: start, period_end: end, paid_by: p.paidBy })
    .execute();
  await trx
    .insertInto('employer_subscriptions')
    .values({ organisation_id: p.organisationId, plan: p.plan, billing_cycle: p.cycle, period_start: start, period_end: end, source: 'payment', updated_by: p.paidBy })
    .onConflict((oc) =>
      oc.column('organisation_id').doUpdateSet({
        plan: p.plan,
        billing_cycle: p.cycle,
        period_start: start === now ? now : sql`employer_subscriptions.period_start`,
        period_end: end,
        source: 'payment',
        updated_by: p.paidBy,
        updated_at: now,
      }),
    )
    .execute();
  await audit(trx, ctx, {
    action: 'subscription.paid',
    entityType: 'organisation',
    entityId: p.organisationId,
    before: { plan: current, period_end: row ? iso(row.period_end) : null },
    after: { plan: p.plan, cycle: p.cycle, amount_paise: p.amountPaise, gst_paise: p.gstPaise ?? 0, invoice, period_end: iso(end), provider: p.provider, ...(p.providerPaymentId ? { razorpay_payment_id: p.providerPaymentId } : {}) },
  });
  const name = partner ? (await partnerPlan(trx, p.plan as PaidPartnerPlan)).name : (await employerPlan(trx, p.plan as Plan)).name;
  await notify(trx, await orgMembers(trx, p.organisationId, [partner ? 'partner_admin' : 'employer_admin']), 'plan_activated', { plan: name, until: istDay(end), invoice }, partner ? '/partner/subscription' : '/employer/subscription', { except: ctx.actorId ?? undefined });
  return { paymentId: id, invoiceNumber: invoice };
}

/**
 * Phase 12: employer plans, payments and invoices.
 * Payments run in 'test' mode on local and staging copies: no money moves, no card details are asked for, and
 * every receipt says so. A real payment provider needs an account and keys from AutoTalent Grid.
 */
export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const mode = app.config.paymentMode;

  app.get('/employer/subscription', { config: { permission: 'employer.subscription.read' } }, async (req) => subscriptionDto(db, employerOrgId(req), mode));

  const paymentDto = (p: { id: string; plan: string; billing_cycle: string; amount_paise: number; method: string; provider: string; invoice_number: string; period_start: Date; period_end: Date; created_at: Date }) => ({
    id: p.id,
    plan: p.plan,
    cycle: p.billing_cycle,
    amountPaise: p.amount_paise,
    method: p.method,
    test: p.provider === 'test',
    invoiceNumber: p.invoice_number,
    periodStart: iso(p.period_start),
    periodEnd: iso(p.period_end),
    paidAt: iso(p.created_at),
  });

  app.get('/employer/subscription/payments', { config: { permission: 'employer.subscription.read' } }, async (req) => {
    const rows = await db.selectFrom('subscription_payments').selectAll().where('organisation_id', '=', employerOrgId(req)).orderBy('created_at', 'desc').limit(100).execute();
    return { items: rows.map(paymentDto) };
  });

  app.get('/employer/subscription/payments/:id', { config: { permission: 'employer.subscription.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const p = await db
      .selectFrom('subscription_payments as p')
      .innerJoin('organisations as o', 'o.id', 'p.organisation_id')
      .innerJoin('users as u', 'u.id', 'p.paid_by')
      .selectAll('p')
      .select(['o.legal_name', 'o.city', 'o.contact_email', 'u.name as paid_by_name'])
      .where('p.id', '=', id)
      .where('p.organisation_id', '=', employerOrgId(req))
      .executeTakeFirst();
    if (!p) throw notFound('Invoice');
    return { ...paymentDto(p), company: { name: p.legal_name, city: p.city, email: p.contact_email }, paidByName: p.paid_by_name };
  });

  /**
   * Buy or renew a plan. Paying for the plan you already have extends it from its end date; a different plan
   * starts now (no refund or credit for the old one: shown before paying).
   */
  app.post('/employer/subscription/checkout', { config: { permission: 'employer.subscription' } }, async (req, reply) => {
    const b = parse(checkoutSchema, req.body);
    if (mode === 'none') throw conflict('Online payment is not set up yet. Ask AutoTalent Grid to set up your plan.');
    if (mode === 'test' && !b.method) throw invalid('Choose how to pay', { method: 'Choose how to pay' });
    const org = await employerOrg(db, req);
    assertVerified(org);
    const { plan: current } = await currentSubscription(db, org.id);
    if (current === 'enterprise') throw conflict('Your Enterprise plan is managed by AutoTalent Grid. Contact them to change it.');
    const info = await employerPlan(db, b.plan);
    if (!info.price) throw conflict('This plan is set up with AutoTalent Grid. Ask them about it.');
    const amount = info.price[b.cycle];
    if (amount <= 0) throw conflict('This plan has no price for that billing period. Ask AutoTalent Grid about it.');
    reply.code(201);
    // Razorpay: the plan starts when the payment is verified (POST /payments/:id/verify, or the webhook).
    if (mode === 'razorpay') {
      const payer = await db.selectFrom('users').select(['name', 'email', 'phone']).where('id', '=', req.actor!.userId).executeTakeFirstOrThrow();
      return startRazorpayOrder(app, {
        purpose: 'plan',
        amountPaise: amount,
        payerId: req.actor!.userId,
        organisationId: org.id,
        plan: b.plan,
        cycle: b.cycle,
        description: `${info.name} plan, ${b.cycle}`,
        prefill: { name: payer.name, email: payer.email ?? undefined, contact: payer.phone ?? undefined },
        ctx: auditCtx(req),
      });
    }
    return db.transaction().execute((trx) =>
      activatePlan(trx, auditCtx(req), { organisationId: org.id, plan: b.plan, cycle: b.cycle, amountPaise: amount, method: b.method!, provider: 'test', paidBy: req.actor!.userId }),
    );
  });

  /** Enterprise, or any plan while online payment is off: AutoTalent Grid staff are told and follow up. */
  app.post('/employer/subscription/request', { config: { permission: 'employer.subscription' } }, async (req) => {
    const b = parse(planRequestSchema, req.body);
    const org = await employerOrg(db, req);
    await db.transaction().execute(async (trx) => {
      await audit(trx, auditCtx(req), { action: 'subscription.requested', entityType: 'organisation', entityId: org.id, after: { plan: b.plan, cycle: b.cycle ?? null } });
      await notify(trx, await vtaReviewers(trx), 'plan_requested', { org: org.legal_name, plan: (await employerPlan(trx, b.plan)).name, note: b.note ?? '' }, '/admin/organisations?type=employer');
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- AutoTalent Grid staff

  app.get('/admin/organisations/:id/subscription', { config: { permission: 'subscription.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const org = await db.selectFrom('organisations').select(['id', 'type']).where('id', '=', id).executeTakeFirst();
    if (!org || (org.type !== 'employer' && org.type !== 'partner')) throw notFound('Organisation');
    const payments = await db.selectFrom('subscription_payments').selectAll().where('organisation_id', '=', id).orderBy('created_at', 'desc').limit(20).execute();
    const dto = org.type === 'partner' ? await partnerSubscriptionDto(db, id, mode) : await subscriptionDto(db, id, mode);
    return { ...dto, audience: org.type, payments: payments.map(paymentDto) };
  });

  /** Set a plan by hand, for Enterprise or a payment taken outside the platform. Free ends the current plan now. */
  app.post('/admin/organisations/:id/subscription', { config: { permission: 'subscription.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(adminSetPlanSchema, req.body);
    const org = await db.selectFrom('organisations').select(['id', 'type']).where('id', '=', id).executeTakeFirst();
    if (!org || (org.type !== 'employer' && org.type !== 'partner')) throw notFound('Organisation');
    const partner = org.type === 'partner';
    if (partner ? !(PARTNER_PLANS as readonly string[]).includes(b.plan) : !(PLANS as readonly string[]).includes(b.plan)) {
      throw invalid('Choose one of this organisation’s plans', { plan: partner ? 'A training partner plan' : 'An employer plan' });
    }
    const now = new Date();
    const { plan: before, row } = partner ? await currentPartnerPlan(db, id, now) : await currentSubscription(db, id, now);
    const end = b.plan === 'free' ? null : addPeriod(now, 'monthly', b.months ?? 1);
    await db.transaction().execute(async (trx) => {
      if (b.plan === 'free') {
        await trx.deleteFrom('employer_subscriptions').where('organisation_id', '=', id).execute();
      } else {
        const values = { plan: b.plan as Exclude<typeof b.plan, 'free'>, billing_cycle: null, period_start: now, period_end: end!, source: 'admin' as const, updated_by: req.actor!.userId };
        await trx
          .insertInto('employer_subscriptions')
          .values({ organisation_id: id, ...values })
          .onConflict((oc) => oc.column('organisation_id').doUpdateSet({ ...values, updated_at: now }))
          .execute();
      }
      await audit(trx, auditCtx(req), {
        action: 'subscription.set',
        entityType: 'organisation',
        entityId: id,
        before: { plan: before, period_end: row ? iso(row.period_end) : null },
        after: { plan: b.plan, period_end: end ? iso(end) : null, reason: b.reason },
      });
      const name = partner ? (await partnerPlan(trx, b.plan as PartnerPlan)).name : (await employerPlan(trx, b.plan as Plan)).name;
      if (partner) await notify(trx, await orgMembers(trx, id, ['partner_admin']), 'plan_set', { plan: name, until: end ? istDay(end) : '' }, '/partner/subscription');
      else await notify(trx, await orgMembers(trx, id, EMPLOYER_TEAM), 'plan_set', { plan: name, until: end ? istDay(end) : '' }, '/employer/subscription');
    });
    return partner ? partnerSubscriptionDto(db, id, mode) : subscriptionDto(db, id, mode);
  });
};
