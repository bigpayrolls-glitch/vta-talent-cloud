import { adminSetPlanSchema, checkoutSchema, PLAN_INFO, planRequestSchema, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { conflict, notFound } from '../../lib/errors.js';
import { EMPLOYER_TEAM, notify, orgMembers, vtaReviewers } from '../../lib/notify.js';
import { addPeriod, currentSubscription, subscriptionDto } from '../../lib/subscriptions.js';
import { iso, parse } from '../../lib/validate.js';
import { assertVerified, employerOrg, employerOrgId } from './common.js';

const idParam = z.object({ id: uuidSchema });

/** "30 Nov 2026" in India time. */
const istDay = (d: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);

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
    if (mode !== 'test') throw conflict('Online payment is not set up yet. Ask AutoTalent Grid to set up your plan.');
    const org = await employerOrg(db, req);
    assertVerified(org);
    const now = new Date();
    const { plan: current, row } = await currentSubscription(db, org.id, now);
    if (current === 'enterprise') throw conflict('Your Enterprise plan is managed by AutoTalent Grid. Contact them to change it.');
    const start = current === b.plan && row && row.billing_cycle === b.cycle ? row.period_end : now;
    const end = addPeriod(start, b.cycle);
    const amount = PLAN_INFO[b.plan].price![b.cycle];
    const id = newId();
    let invoice = '';
    await db.transaction().execute(async (trx) => {
      const seq = (await sql<{ n: string }>`SELECT nextval('invoice_number_seq') AS n`.execute(trx)).rows[0]!.n;
      const day = new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
      invoice = `INV-${day}-${String(seq).padStart(4, '0')}`;
      await trx
        .insertInto('subscription_payments')
        .values({ id, organisation_id: org.id, plan: b.plan, billing_cycle: b.cycle, amount_paise: amount, method: b.method, provider: 'test', status: 'succeeded', invoice_number: invoice, period_start: start, period_end: end, paid_by: req.actor!.userId })
        .execute();
      await trx
        .insertInto('employer_subscriptions')
        .values({ organisation_id: org.id, plan: b.plan, billing_cycle: b.cycle, period_start: start, period_end: end, source: 'payment', updated_by: req.actor!.userId })
        .onConflict((oc) =>
          oc.column('organisation_id').doUpdateSet({
            plan: b.plan,
            billing_cycle: b.cycle,
            period_start: start === now ? now : sql`employer_subscriptions.period_start`,
            period_end: end,
            source: 'payment',
            updated_by: req.actor!.userId,
            updated_at: now,
          }),
        )
        .execute();
      await audit(trx, auditCtx(req), {
        action: 'subscription.paid',
        entityType: 'organisation',
        entityId: org.id,
        before: { plan: current, period_end: row ? iso(row.period_end) : null },
        after: { plan: b.plan, cycle: b.cycle, amount_paise: amount, invoice, period_end: iso(end), test: true },
      });
      await notify(trx, await orgMembers(trx, org.id, ['employer_admin']), 'plan_activated', { plan: PLAN_INFO[b.plan].name, until: istDay(end), invoice }, '/employer/subscription', { except: req.actor!.userId });
    });
    reply.code(201);
    return { paymentId: id, invoiceNumber: invoice };
  });

  /** Enterprise, or any plan while online payment is off: AutoTalent Grid staff are told and follow up. */
  app.post('/employer/subscription/request', { config: { permission: 'employer.subscription' } }, async (req) => {
    const b = parse(planRequestSchema, req.body);
    const org = await employerOrg(db, req);
    await db.transaction().execute(async (trx) => {
      await audit(trx, auditCtx(req), { action: 'subscription.requested', entityType: 'organisation', entityId: org.id, after: { plan: b.plan, cycle: b.cycle ?? null } });
      await notify(trx, await vtaReviewers(trx), 'plan_requested', { org: org.legal_name, plan: PLAN_INFO[b.plan].name, note: b.note ?? '' }, '/admin/organisations?type=employer');
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- AutoTalent Grid staff

  app.get('/admin/organisations/:id/subscription', { config: { permission: 'subscription.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const org = await db.selectFrom('organisations').select(['id', 'type']).where('id', '=', id).executeTakeFirst();
    if (!org || org.type !== 'employer') throw notFound('Employer');
    const payments = await db.selectFrom('subscription_payments').selectAll().where('organisation_id', '=', id).orderBy('created_at', 'desc').limit(20).execute();
    return { ...(await subscriptionDto(db, id, mode)), payments: payments.map(paymentDto) };
  });

  /** Set a plan by hand, for Enterprise or a payment taken outside the platform. Free ends the current plan now. */
  app.post('/admin/organisations/:id/subscription', { config: { permission: 'subscription.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(adminSetPlanSchema, req.body);
    const org = await db.selectFrom('organisations').select(['id', 'type']).where('id', '=', id).executeTakeFirst();
    if (!org || org.type !== 'employer') throw notFound('Employer');
    const now = new Date();
    const { plan: before, row } = await currentSubscription(db, id, now);
    const end = b.plan === 'free' ? null : addPeriod(now, 'monthly', b.months ?? 1);
    await db.transaction().execute(async (trx) => {
      if (b.plan === 'free') {
        await trx.deleteFrom('employer_subscriptions').where('organisation_id', '=', id).execute();
      } else {
        const values = { plan: b.plan, billing_cycle: null, period_start: now, period_end: end!, source: 'admin' as const, updated_by: req.actor!.userId };
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
      await notify(trx, await orgMembers(trx, id, EMPLOYER_TEAM), 'plan_set', { plan: PLAN_INFO[b.plan].name, until: end ? istDay(end) : '' }, '/employer/subscription');
    });
    return subscriptionDto(db, id, mode);
  });
};
