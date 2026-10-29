import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { mapPayment, signForTests, type GatewayPayment, type PaymentGateway } from '../src/lib/razorpay.js';
import { localStorage } from '../src/lib/storage.js';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Razorpay payments for plans and course fees: nothing is granted until a verified, matching, captured payment. */

class FakeRazorpay implements PaymentGateway {
  readonly keyId = 'rzp_test_fake';
  readonly keySecret = 'fake_key_secret';
  readonly webhookSecret = 'fake_webhook_secret';
  orders = new Map<string, number>();
  payments = new Map<string, GatewayPayment>();
  captured: string[] = [];
  private n = 0;
  async createOrder(i: { amountPaise: number }) {
    const id = `order_Fake${++this.n}`;
    this.orders.set(id, i.amountPaise);
    return { id, amountPaise: i.amountPaise };
  }
  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('no such payment');
    return { ...p };
  }
  async capturePayment(id: string) {
    const p = this.payments.get(id)!;
    p.status = 'captured';
    this.captured.push(id);
    return { ...p };
  }
  /** The customer pays in Checkout. */
  pay(orderId: string, o: { status?: GatewayPayment['status']; amount?: number; method?: string } = {}) {
    const id = `pay_Fake${++this.n}abcdef`;
    this.payments.set(id, mapPayment({ id, order_id: orderId, status: o.status ?? 'captured', amount: o.amount ?? this.orders.get(orderId)!, currency: 'INR', method: o.method ?? 'upi' }));
    return { razorpayPaymentId: id, razorpaySignature: signForTests(this.keySecret, `${orderId}|${id}`) };
  }
}

let ctx: Ctx;
let rzp: FakeRazorpay;
let app: Awaited<ReturnType<typeof buildApp>>;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  rzp = new FakeRazorpay();
  app = await buildApp({ db: ctx.db, config: { ...ctx.app.config, paymentMode: 'razorpay' }, providers: ctx.mem, gateway: rzp, storage: localStorage(mkdtempSync(path.join(tmpdir(), 'rzp-'))), logger: false });
  await app.ready();
  const on = { ...ctx, app };
  c.employer = await loginEmail(on, EMAIL.employerAdminA);
  c.employerB = await loginEmail(on, EMAIL.employerAdminB);
  c.learner = await loginPhone(on, PHONE.learner);
  c.admin = await loginEmail(on, EMAIL.secondAdmin);
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

describe('settings', () => {
  const prod = { NODE_ENV: 'production', APP_ENV: 'production', COOKIE_SECURE: 'true', FILE_SIGNING_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h:5432/d', APP_ORIGIN: 'https://www.autotalentgrid.com', VERIFYNOW_CUSTOMER_ID: 'C-1', VERIFYNOW_KEY: 'k', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASSWORD: 'p' };
  it('Razorpay keys switch payments on; without them the live site asks AutoTalent Grid instead', () => {
    expect(loadConfig({ ...prod }).paymentMode).toBe('none');
    expect(loadConfig({ ...prod, RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's' }).paymentMode).toBe('razorpay');
    expect(() => loadConfig({ ...prod, RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' })).toThrow(/live keys/);
    expect(() => loadConfig({ NODE_ENV: 'development', PAYMENT_MODE: 'razorpay' })).toThrow(/RAZORPAY_KEY_ID/);
    expect(loadConfig({ NODE_ENV: 'development', RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 's' }).paymentMode).toBe('razorpay');
  });
});

describe('employer plan', () => {
  let orderId = '';
  let rzpOrder = '';

  it('checkout makes a Razorpay order and starts nothing yet', async () => {
    const r = await c.employer!.post('/employer/subscription/checkout', { plan: 'starter', cycle: 'monthly', acceptTerms: true });
    expect(r.status).toBe(201);
    expect(r.body.razorpay).toMatchObject({ keyId: 'rzp_test_fake', amount: 99_900, currency: 'INR', name: 'AutoTalent Grid', description: 'Starter plan, monthly' });
    orderId = r.body.orderId;
    rzpOrder = r.body.razorpay.orderId;
    expect((await c.employer!.get('/employer/subscription')).body.plan).toBe('growth');
  });

  it('refuses a wrong signature and someone else\'s order', async () => {
    const good = rzp.pay(rzpOrder);
    expect((await c.employer!.post(`/payments/${orderId}/verify`, { ...good, razorpaySignature: 'a'.repeat(64) })).status).toBe(400);
    expect((await c.employerB!.post(`/payments/${orderId}/verify`, good)).status).toBe(404);
    expect((await ctx.db.selectFrom('payment_orders').select('status').where('id', '=', orderId).executeTakeFirstOrThrow()).status).toBe('created');
  });

  it('a verified payment starts the plan with an invoice, once', async () => {
    const pay = rzp.pay(rzpOrder, { method: 'card' });
    const r = await c.employer!.post(`/payments/${orderId}/verify`, pay);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'paid', purpose: 'plan', paymentId: expect.any(String) });
    const sub = (await c.employer!.get('/employer/subscription')).body;
    expect(sub).toMatchObject({ plan: 'starter', cycle: 'monthly', paymentMode: 'razorpay' });
    const inv = (await c.employer!.get(`/employer/subscription/payments/${r.body.paymentId}`)).body;
    expect(inv).toMatchObject({ test: false, method: 'card', amountPaise: 99_900, invoiceNumber: expect.stringMatching(/^INV-\d{8}-\d{4}$/) });
    const again = await c.employer!.post(`/payments/${orderId}/verify`, pay);
    expect(again.body).toEqual(r.body);
    const rows = await ctx.db.selectFrom('subscription_payments').select('provider_payment_id').where('provider', '=', 'razorpay').execute();
    expect(rows).toEqual([{ provider_payment_id: pay.razorpayPaymentId }]);
  });

  it('an authorised payment is captured; a short or failed payment starts nothing', async () => {
    const o = (await c.employerB!.post('/employer/subscription/checkout', { plan: 'growth', cycle: 'yearly', acceptTerms: true })).body;
    const short = rzp.pay(o.razorpay.orderId, { amount: 100 });
    expect((await c.employerB!.post(`/payments/${o.orderId}/verify`, short)).status).toBe(409);
    const failed = rzp.pay(o.razorpay.orderId, { status: 'failed' });
    expect((await c.employerB!.post(`/payments/${o.orderId}/verify`, failed)).status).toBe(409);
    expect((await c.employerB!.get('/employer/subscription')).body.plan).toBe('starter');
    const auth = rzp.pay(o.razorpay.orderId, { status: 'authorized' });
    const r = await c.employerB!.post(`/payments/${o.orderId}/verify`, auth);
    expect(r.body.status).toBe('paid');
    expect(rzp.captured).toEqual([auth.razorpayPaymentId]);
    expect((await c.employerB!.get('/employer/subscription')).body).toMatchObject({ plan: 'growth', cycle: 'yearly' });
  });
});

describe('course fee', () => {
  it('enrolling in a paid course makes an order; the seat is confirmed when the payment is verified', async () => {
    const o = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, acceptTerms: true });
    expect(o.status).toBe(201);
    expect(o.body.razorpay).toMatchObject({ amount: 499_900, description: '2W Service Technician: 2W Peenya November 2026' });
    const before = await ctx.db.selectFrom('enrolments').select('id').where('batch_id', '=', ctx.ids.batchOpen2w!).execute();
    expect(before).toHaveLength(0);
    const r = await c.learner!.post(`/payments/${o.body.orderId}/verify`, rzp.pay(o.body.razorpay.orderId));
    expect(r.body).toMatchObject({ status: 'paid', purpose: 'course', enrolmentId: expect.any(String) });
    const rec = (await c.learner!.get(`/me/enrolments/${r.body.enrolmentId}/receipt`)).body;
    expect(rec).toMatchObject({ amountRupees: 4999, test: false, free: false, status: 'enrolled', method: 'upi' });
  });

  it('if the seat is gone by the time the money arrives, the order is marked for a refund and Admins are told', async () => {
    await ctx.db.updateTable('enrolments').set({ status: 'withdrawn' }).where('batch_id', '=', ctx.ids.batchOpen2w!).execute();
    const o = (await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, acceptTerms: true })).body;
    await ctx.db.updateTable('batches').set({ status: 'completed' }).where('id', '=', ctx.ids.batchOpen2w!).execute();
    const r = await c.learner!.post(`/payments/${o.orderId}/verify`, rzp.pay(o.razorpay.orderId));
    expect(r.body).toMatchObject({ status: 'needs_refund', purpose: 'course' });
    expect(r.body.message).toBe('Your payment was received, but this batch is no longer open for enrolment. AutoTalent Grid has been told and will refund it in full.');
    const n = (await c.admin!.get('/notifications')).body.items.find((x: { title: string }) => x.title.startsWith('Refund needed'));
    expect(n.title).toMatch(/^Refund needed: ₹4,999 from \S/);
    await ctx.db.updateTable('batches').set({ status: 'planned' }).where('id', '=', ctx.ids.batchOpen2w!).execute();
  });
});

describe('career journey course', () => {
  it('enrolling makes an order for the course; the booking is made when the payment is verified', async () => {
    const step1 = (await ctx.db.selectFrom('courses').select('id').where('code', '=', 'ATG-SA-1').executeTakeFirstOrThrow()).id;
    await ctx.db.updateTable('courses').set({ fee_paise: 250_000, status: 'active' }).where('id', '=', step1).execute();
    const o = await c.learner!.post('/me/bookings', { courseId: step1, acceptTerms: true });
    expect(o.status).toBe(201);
    expect(o.body.razorpay).toMatchObject({ amount: 250_000, description: 'Service Advisor Beginner: Job Card, Process and AMC Basics' });
    expect(await ctx.db.selectFrom('course_bookings').select('id').where('course_id', '=', step1).execute()).toHaveLength(0);
    const r = await c.learner!.post(`/payments/${o.body.orderId}/verify`, rzp.pay(o.body.razorpay.orderId));
    expect(r.body).toMatchObject({ status: 'paid', purpose: 'booking', bookingId: expect.any(String) });
    expect((await c.learner!.get(`/me/bookings/${r.body.bookingId}/receipt`)).body).toMatchObject({ amountRupees: 2500, test: false, status: 'awaiting_batch', method: 'upi' });
  });
});

describe('webhook', () => {
  const hook = (body: object, opts: { sig?: string; id?: string } = {}) => {
    const raw = JSON.stringify(body);
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/razorpay/webhook',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': opts.sig ?? signForTests(rzp.webhookSecret, raw), 'x-razorpay-event-id': opts.id ?? `evt_${Math.random().toString(36).slice(2)}` },
      payload: raw,
    });
  };

  it('completes a payment when the browser closed before verifying; repeats and bad signatures do nothing', async () => {
    await ctx.db.updateTable('enrolments').set({ status: 'withdrawn' }).where('batch_id', '=', ctx.ids.batchOpen2w!).execute();
    const res = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, acceptTerms: true });
    expect(res.body.error).toBeUndefined();
    const o = res.body;
    const { razorpayPaymentId } = rzp.pay(o.razorpay.orderId);
    const event = { event: 'payment.captured', payload: { payment: { entity: { id: razorpayPaymentId, order_id: o.razorpay.orderId, status: 'captured' } } } };
    expect((await hook(event, { sig: 'b'.repeat(64) })).statusCode).toBe(400);
    const first = await hook(event, { id: 'evt_one' });
    expect(first.statusCode).toBe(200);
    const order = await ctx.db.selectFrom('payment_orders').selectAll().where('id', '=', o.orderId).executeTakeFirstOrThrow();
    expect(order).toMatchObject({ status: 'paid', provider_payment_id: razorpayPaymentId });
    expect((await hook(event, { id: 'evt_one' })).json()).toEqual({ ok: true, duplicate: true });
    // Verifying afterwards from the browser gives the same result.
    const v = await c.learner!.post(`/payments/${o.orderId}/verify`, { razorpayPaymentId, razorpaySignature: signForTests(rzp.keySecret, `${o.razorpay.orderId}|${razorpayPaymentId}`) });
    expect(v.body).toMatchObject({ status: 'paid', enrolmentId: order.result_id });
    expect(await ctx.db.selectFrom('course_payments').select('id').where('provider_payment_id', '=', razorpayPaymentId).execute()).toHaveLength(1);
  });

  it('ignores events for orders it does not know', async () => {
    const r = await hook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_Other123456', order_id: 'order_NotOurs' } } } }, { id: 'evt_other' });
    expect(r.statusCode).toBe(200);
    expect((await ctx.db.selectFrom('payment_webhook_events').select('outcome').where('event_id', '=', 'evt_other').executeTakeFirstOrThrow()).outcome).toBe('unknown order');
  });
});
