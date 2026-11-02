import { uuidSchema } from '@vta/shared';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../app.js';
import { audit, type AuditContext } from '../audit/service.js';
import type { DB } from '../db/index.js';
import { ApiError, conflict, invalid, notFound } from '../lib/errors.js';
import { notify, vtaReviewers } from '../lib/notify.js';
import { cashfreeWebhookOk } from '../lib/cashfree.js';
import { checkoutSignatureOk, gatewayUnavailable, kindOf, recordedMethod, webhookSignatureOk, type GatewayPayment } from '../lib/razorpay.js';
import { parse } from '../lib/validate.js';
import { activatePlan } from './hiring/subscription.js';
import { createBooking } from './learner/bookings.js';
import { enrolSelf } from './learner/catalogue.js';

const idParam = z.object({ id: uuidSchema });
const verifySchema = z.object({
  razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/, 'Invalid payment'),
  razorpaySignature: z.string().regex(/^[0-9a-f]{64}$/i, 'Invalid signature'),
});
/** Cashfree's Checkout gives the browser nothing to check; the server asks Cashfree. */
const cashfreeVerifySchema = z.object({}).passthrough();

export type PaymentOutcome =
  | { status: 'paid'; purpose: 'plan'; paymentId: string }
  | { status: 'paid'; purpose: 'course'; enrolmentId: string }
  | { status: 'paid'; purpose: 'booking'; bookingId: string }
  | { status: 'needs_refund'; purpose: 'plan' | 'course' | 'booking'; message: string }
  | { status: 'pending'; message: string };

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

function outcomeOf(o: { status: string; purpose: 'plan' | 'course' | 'booking'; result_id: string | null; failure: string | null }): PaymentOutcome | null {
  if (o.status === 'paid' && o.result_id) {
    if (o.purpose === 'plan') return { status: 'paid', purpose: 'plan', paymentId: o.result_id };
    if (o.purpose === 'booking') return { status: 'paid', purpose: 'booking', bookingId: o.result_id };
    return { status: 'paid', purpose: 'course', enrolmentId: o.result_id };
  }
  if (o.status === 'needs_refund') {
    return { status: 'needs_refund', purpose: o.purpose, message: `Your payment was received, but ${o.failure ?? 'it could not be used.'} AutoTalent Grid has been told and will refund it in full.` };
  }
  return null;
}

/**
 * Applies a provider's payment to its order, once. Called after Checkout and from webhooks.
 * The payment is fetched from the provider (Razorpay or Cashfree) and must belong to this order, be for the full
 * amount in INR, and be captured (a Razorpay payment that is only authorised is captured here). Then the plan starts or the seat is confirmed; if the seat
 * has gone in the meantime, the order is marked for a refund and Admins are told.
 */
export async function completeOrder(app: FastifyInstance, orderId: string, paymentId: string, ctx: AuditContext): Promise<PaymentOutcome> {
  const db = app.db;
  const gateway = app.gateway;
  if (!gateway) throw gatewayUnavailable();
  const kind = kindOf(gateway);
  const order = await db.selectFrom('payment_orders').selectAll().where('id', '=', orderId).executeTakeFirst();
  if (!order) throw notFound('Payment');
  const done = outcomeOf(order);
  if (done && order.provider_payment_id === paymentId) return done;
  if (order.provider !== kind) {
    app.log.warn({ orderId, provider: order.provider }, 'Payment order belongs to another provider');
    throw conflict('This payment was started with another payment provider. Contact AutoTalent Grid.');
  }

  let payment: GatewayPayment;
  try {
    payment = await gateway.fetchPayment(paymentId, order.provider_order_id);
    if (kind === 'razorpay' && payment.status === 'authorized' && payment.orderId === order.provider_order_id && payment.amountPaise === order.amount_paise) {
      payment = await gateway.capturePayment(paymentId, order.amount_paise);
    }
  } catch (e) {
    if (e instanceof ApiError) app.log.error({ gateway: (e as { gateway?: string }).gateway, provider: kind }, 'Payment could not be fetched or captured');
    throw gatewayUnavailable();
  }
  if (payment.orderId !== order.provider_order_id || payment.amountPaise !== order.amount_paise || payment.currency !== 'INR') {
    app.log.warn({ orderId, paymentId, provider: kind }, 'Payment does not match its order');
    throw conflict('This payment does not match the order. Contact AutoTalent Grid.');
  }
  if (payment.status !== 'captured') throw conflict('The payment has not completed. If money left your account, it will be returned by your bank.');

  return db.transaction().execute(async (trx) => {
    const o = await trx.selectFrom('payment_orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirstOrThrow();
    const already = outcomeOf(o);
    if (already) {
      if (o.provider_payment_id !== paymentId) {
        // A second successful payment for an order that was already settled: refund it by hand.
        await flagRefund(trx, o, paymentId, 'this order had already been paid.', ctx, false);
      }
      return already;
    }
    const method = recordedMethod(payment.method);
    if (o.purpose === 'plan') {
      const r = await activatePlan(trx, ctx, { organisationId: o.organisation_id!, plan: o.plan!, cycle: o.billing_cycle!, amountPaise: o.amount_paise, gstPaise: o.gst_paise, method, provider: kind, providerPaymentId: paymentId, paidBy: o.payer_id });
      await trx.updateTable('payment_orders').set({ status: 'paid', provider_payment_id: paymentId, result_id: r.paymentId, paid_at: new Date(), updated_at: new Date() }).where('id', '=', o.id).execute();
      return { status: 'paid', purpose: 'plan', paymentId: r.paymentId } as const;
    }
    if (o.purpose === 'booking') {
      const k = await createBooking(trx, ctx, o.payer_id, o.course_id!, { provider: kind, method, providerPaymentId: paymentId, expectedAmount: o.amount_paise, needsStay: o.needs_stay });
      if ('blocked' in k) {
        const reason = k.blocked.replace(/\.$/, '').toLowerCase();
        await flagRefund(trx, o, paymentId, `${reason}.`, ctx, true);
        return outcomeOf({ ...o, status: 'needs_refund', failure: `${reason}.` })!;
      }
      await trx.updateTable('payment_orders').set({ status: 'paid', provider_payment_id: paymentId, result_id: k.bookingId, paid_at: new Date(), updated_at: new Date() }).where('id', '=', o.id).execute();
      return { status: 'paid', purpose: 'booking', bookingId: k.bookingId } as const;
    }
    const r = await enrolSelf(trx, ctx, o.payer_id, o.batch_id!, { provider: kind, method, providerPaymentId: paymentId, expectedFee: o.amount_paise, needsStay: o.needs_stay });
    if ('blocked' in r) {
      const reason = r.blocked.replace(/\.$/, '').toLowerCase();
      await flagRefund(trx, o, paymentId, `${reason}.`, ctx, true);
      return outcomeOf({ ...o, status: 'needs_refund', failure: `${reason}.` })!;
    }
    await trx.updateTable('payment_orders').set({ status: 'paid', provider_payment_id: paymentId, result_id: r.enrolmentId, paid_at: new Date(), updated_at: new Date() }).where('id', '=', o.id).execute();
    return { status: 'paid', purpose: 'course', enrolmentId: r.enrolmentId } as const;
  });
}

async function flagRefund(
  trx: DB,
  o: { id: string; amount_paise: number; payer_id: string },
  paymentId: string,
  reason: string,
  ctx: AuditContext,
  markOrder: boolean,
) {
  if (markOrder) {
    await trx.updateTable('payment_orders').set({ status: 'needs_refund', provider_payment_id: paymentId, failure: reason, updated_at: new Date() }).where('id', '=', o.id).execute();
  }
  await audit(trx, ctx, { action: 'payment.needs_refund', entityType: 'payment_order', entityId: o.id, after: { provider_payment_id: paymentId, amount_paise: o.amount_paise, reason } });
  const payer = await trx.selectFrom('users').select('name').where('id', '=', o.payer_id).executeTakeFirst();
  await notify(trx, await vtaReviewers(trx), 'payment_needs_refund', { amount: money(o.amount_paise), payer: payer?.name ?? 'a user', payment: paymentId, reason: reason.charAt(0).toUpperCase() + reason.slice(1) }, '/admin');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Online payments: verify after Checkout, and the providers' webhooks (in case the browser closed before verifying). */
export const paymentRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.post('/payments/:id/verify', { config: { permission: 'self.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const order = await db.selectFrom('payment_orders').select(['id', 'provider_order_id', 'payer_id', 'status', 'purpose', 'result_id', 'failure']).where('id', '=', id).executeTakeFirst();
    if (!order || order.payer_id !== req.actor!.userId) throw notFound('Payment');
    if (!app.gateway) throw gatewayUnavailable();
    if (kindOf(app.gateway) === 'cashfree') {
      parse(cashfreeVerifySchema, req.body ?? {});
      const done = outcomeOf(order);
      if (done) return done;
      let paid: GatewayPayment | null;
      try {
        paid = (await app.gateway.findPaidPayment?.(order.provider_order_id)) ?? null;
      } catch (e) {
        app.log.error({ gateway: (e as { gateway?: string }).gateway, provider: 'cashfree' }, 'Cashfree payments could not be read');
        throw gatewayUnavailable();
      }
      if (!paid) return { status: 'pending', message: 'We have not received this payment yet. If money left your account, it is confirmed within a few minutes.' } satisfies PaymentOutcome;
      return completeOrder(app, id, paid.id, auditCtx(req));
    }
    const b = parse(verifySchema, req.body);
    if (!checkoutSignatureOk(app.gateway.keySecret, order.provider_order_id, b.razorpayPaymentId, b.razorpaySignature)) {
      throw invalid('The payment could not be verified. If money left your account, contact AutoTalent Grid.');
    }
    return completeOrder(app, id, b.razorpayPaymentId, auditCtx(req));
  });

  // The webhook needs the exact bytes Razorpay signed, so JSON is read raw here only.
  await app.register(async (hook) => {
    hook.removeContentTypeParser('application/json');
    hook.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 262_144 }, (_req, body, done) => done(null, body));

    hook.post('/payments/cashfree/webhook', { config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      const gw = app.gateway;
      if (!gw || kindOf(gw) !== 'cashfree' || !gw.webhookSecret) throw new ApiError('UNAVAILABLE', 'Webhooks are not set up.');
      const raw = req.body as Buffer | undefined;
      const signature = req.headers['x-webhook-signature'];
      const timestamp = req.headers['x-webhook-timestamp'];
      if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || typeof timestamp !== 'string' || !cashfreeWebhookOk(gw.webhookSecret, raw, timestamp, signature)) {
        app.log.warn('Cashfree webhook with a bad signature');
        throw invalid('Invalid signature.');
      }
      let event: unknown = null;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        /* handled below */
      }
      const type = isObj(event) && typeof event.type === 'string' ? event.type.slice(0, 100) : 'unknown';
      const data = isObj(event) && isObj(event.data) ? event.data : null;
      const cfOrder = data && isObj(data.order) && typeof data.order.order_id === 'string' ? data.order.order_id : null;
      const cfPayment = data && isObj(data.payment) && (typeof data.payment.cf_payment_id === 'string' || typeof data.payment.cf_payment_id === 'number') ? String(data.payment.cf_payment_id) : null;
      const id = cfPayment && /^[\w-]{1,60}$/.test(cfPayment) ? `cf:${cfPayment}:${type}` : null;
      if (id && (await db.selectFrom('payment_webhook_events').select('event_id').where('event_id', '=', id).executeTakeFirst())) return { ok: true, duplicate: true };
      let outcome = 'ignored';
      if (type === 'PAYMENT_SUCCESS_WEBHOOK' && cfOrder && cfPayment) {
        const order = await db.selectFrom('payment_orders').select('id').where('provider_order_id', '=', cfOrder).where('provider', '=', 'cashfree').executeTakeFirst();
        if (order) {
          const r = await completeOrder(app, order.id, cfPayment, { actorId: null, requestId: req.id, ip: null });
          outcome = r.status;
        } else outcome = 'unknown order';
      }
      if (id) await db.insertInto('payment_webhook_events').values({ event_id: id, event_type: type, outcome }).onConflict((oc) => oc.column('event_id').doNothing()).execute();
      reply.code(200);
      return { ok: true };
    });

    hook.post('/payments/razorpay/webhook', { config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
      const secret = app.gateway && kindOf(app.gateway) === 'razorpay' ? app.gateway.webhookSecret : undefined;
      if (!secret) throw new ApiError('UNAVAILABLE', 'Webhooks are not set up.');
      const raw = req.body as Buffer | undefined;
      const signature = req.headers['x-razorpay-signature'];
      const eventId = req.headers['x-razorpay-event-id'];
      if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || !webhookSignatureOk(secret, raw, signature)) {
        app.log.warn('Razorpay webhook with a bad signature');
        throw invalid('Invalid signature.');
      }
      const id = typeof eventId === 'string' && /^[\w.-]{1,100}$/.test(eventId) ? eventId : null;
      if (id && (await db.selectFrom('payment_webhook_events').select('event_id').where('event_id', '=', id).executeTakeFirst())) return { ok: true, duplicate: true };

      let event: unknown = null;
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        /* handled below */
      }
      const type = isObj(event) && typeof event.event === 'string' ? event.event.slice(0, 100) : 'unknown';
      const entity = isObj(event) && isObj(event.payload) && isObj(event.payload.payment) && isObj(event.payload.payment.entity) ? event.payload.payment.entity : null;
      let outcome = 'ignored';
      if ((type === 'payment.captured' || type === 'payment.authorized' || type === 'order.paid') && entity && typeof entity.id === 'string' && typeof entity.order_id === 'string') {
        const order = await db.selectFrom('payment_orders').select('id').where('provider_order_id', '=', entity.order_id).executeTakeFirst();
        if (order) {
          const r = await completeOrder(app, order.id, entity.id, { actorId: null, requestId: req.id, ip: null });
          outcome = r.status;
        } else outcome = 'unknown order';
      }
      if (id) await db.insertInto('payment_webhook_events').values({ event_id: id, event_type: type, outcome }).onConflict((oc) => oc.column('event_id').doNothing()).execute();
      reply.code(200);
      return { ok: true };
    });
  });
};
