import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { CashfreeGateway, cashfreeWebhookOk, mapCashfreePayment, signCashfreeForTests } from '../src/lib/cashfree.js';
import type { GatewayPayment, PaymentGateway } from '../src/lib/razorpay.js';
import { localStorage } from '../src/lib/storage.js';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Cashfree payments (2 Nov 2026): the server asks Cashfree; nothing is granted until a matching SUCCESS payment. */

class FakeCashfree implements PaymentGateway {
  readonly kind = 'cashfree' as const;
  readonly mode = 'sandbox' as const;
  readonly keyId = 'TEST_app';
  readonly keySecret = 'cf_test_secret';
  readonly webhookSecret = 'cf_test_secret';
  orders = new Map<string, { amountPaise: number; phone?: string }>();
  payments = new Map<string, GatewayPayment[]>();
  private n = 0;
  async createOrder(i: { amountPaise: number; receipt: string; customer?: { phone?: string } }) {
    this.orders.set(i.receipt, { amountPaise: i.amountPaise, phone: i.customer?.phone });
    return { id: i.receipt, amountPaise: i.amountPaise, sessionId: `session_${i.receipt}` };
  }
  async fetchPayment(id: string, orderId?: string) {
    const p = (this.payments.get(orderId!) ?? []).find((x) => x.id === id);
    if (!p) throw new Error('no such payment');
    return { ...p };
  }
  async capturePayment(): Promise<GatewayPayment> {
    throw new Error('not used');
  }
  async findPaidPayment(orderId: string) {
    return (this.payments.get(orderId) ?? []).find((p) => p.status === 'captured') ?? null;
  }
  /** The customer pays in Cashfree Checkout. */
  pay(orderId: string, o: { status?: string; rupees?: number; group?: string } = {}) {
    const id = String(5000 + ++this.n);
    const p = mapCashfreePayment({ cf_payment_id: id, order_id: orderId, payment_status: o.status ?? 'SUCCESS', payment_amount: o.rupees ?? this.orders.get(orderId)!.amountPaise / 100, payment_currency: 'INR', payment_group: o.group ?? 'upi' }, orderId);
    this.payments.set(orderId, [...(this.payments.get(orderId) ?? []), p]);
    return id;
  }
}

let ctx: Ctx;
let cf: FakeCashfree;
let app: Awaited<ReturnType<typeof buildApp>>;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  cf = new FakeCashfree();
  app = await buildApp({ db: ctx.db, config: { ...ctx.app.config, paymentMode: 'cashfree' }, providers: ctx.mem, gateway: cf, storage: localStorage(mkdtempSync(path.join(tmpdir(), 'cf-'))), logger: false });
  await app.ready();
  const on = { ...ctx, app };
  c.employer = await loginEmail(on, EMAIL.employerAdminA);
  c.employerB = await loginEmail(on, EMAIL.employerAdminB);
  c.learner = await loginPhone(on, PHONE.learner);
});
afterAll(async () => {
  await app.close();
  await ctx.close();
});

describe('settings', () => {
  const prod = { NODE_ENV: 'production', APP_ENV: 'production', COOKIE_SECURE: 'true', FILE_SIGNING_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h:5432/d', APP_ORIGIN: 'https://www.autotalentgrid.com', VERIFYNOW_CUSTOMER_ID: 'C-1', VERIFYNOW_KEY: 'k', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASSWORD: 'p' };
  it('Cashfree keys switch payments to Cashfree, ahead of Razorpay keys; the live site refuses sandbox', () => {
    expect(loadConfig({ ...prod, CASHFREE_APP_ID: 'a', CASHFREE_SECRET_KEY: 's' }).paymentMode).toBe('cashfree');
    expect(loadConfig({ ...prod, CASHFREE_APP_ID: 'a', CASHFREE_SECRET_KEY: 's', RAZORPAY_KEY_ID: 'rzp_live_x', RAZORPAY_KEY_SECRET: 's' }).paymentMode).toBe('cashfree');
    expect(loadConfig({ ...prod, PAYMENT_MODE: 'none', CASHFREE_APP_ID: 'a', CASHFREE_SECRET_KEY: 's' }).paymentMode).toBe('none');
    expect(() => loadConfig({ ...prod, CASHFREE_APP_ID: 'a', CASHFREE_SECRET_KEY: 's', CASHFREE_ENV: 'sandbox' })).toThrow(/production keys/);
    expect(() => loadConfig({ NODE_ENV: 'development', PAYMENT_MODE: 'cashfree' })).toThrow(/CASHFREE_APP_ID/);
  });
});

describe('the Cashfree connection', () => {
  it('creates an order in rupees with the payer, and reads payments back', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === 'POST') return new Response(JSON.stringify({ order_id: 'ord1', order_amount: 1178.82, payment_session_id: 'sess_1' }), { status: 200 });
      return new Response(JSON.stringify([{ cf_payment_id: 991, order_id: 'ord1', payment_status: 'SUCCESS', payment_amount: 1178.82, payment_currency: 'INR', payment_group: 'credit_card' }]), { status: 200 });
    }) as unknown as typeof fetch;
    const g = new CashfreeGateway({ CASHFREE_APP_ID: 'app', CASHFREE_SECRET_KEY: 'sec', CASHFREE_ENV: 'sandbox' }, http);
    const o = await g.createOrder({ amountPaise: 117_882, receipt: 'ord1', notes: { purpose: 'plan' }, customer: { id: 'a1b2-c3', name: 'Rahul', phone: '9900000301' }, returnUrl: 'https://x/pay/return/ord1' });
    expect(o).toEqual({ id: 'ord1', amountPaise: 117_882, sessionId: 'sess_1' });
    expect(calls[0]!.url).toBe('https://sandbox.cashfree.com/pg/orders');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h).toMatchObject({ 'x-client-id': 'app', 'x-client-secret': 'sec', 'x-api-version': '2023-08-01' });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ order_id: 'ord1', order_amount: 1178.82, order_currency: 'INR', customer_details: { customer_id: 'a1b2c3', customer_phone: '9900000301' }, order_meta: { return_url: 'https://x/pay/return/ord1' } });
    expect(await g.findPaidPayment('ord1')).toEqual({ id: '991', orderId: 'ord1', status: 'captured', amountPaise: 117_882, currency: 'INR', method: 'card' });
  });

  it('checks webhook signatures with the secret key', () => {
    const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
    const sig = signCashfreeForTests('sec', '1700000000', body);
    expect(cashfreeWebhookOk('sec', Buffer.from(body), '1700000000', sig)).toBe(true);
    expect(cashfreeWebhookOk('other', Buffer.from(body), '1700000000', sig)).toBe(false);
    expect(cashfreeWebhookOk('sec', Buffer.from(body + ' '), '1700000000', sig)).toBe(false);
  });
});

describe('employer plan', () => {
  let orderId = '';
  it('checkout makes a Cashfree order (the company number when the payer has none) and starts nothing yet', async () => {
    const before = (await c.employer!.get('/employer/subscription')).body.plan;
    const r = await c.employer!.post('/employer/subscription/checkout', { plan: 'starter', cycle: 'monthly', acceptTerms: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ provider: 'cashfree', cashfree: { paymentSessionId: expect.stringMatching(/^session_/), mode: 'sandbox' } });
    orderId = r.body.orderId;
    expect(cf.orders.get(orderId)).toMatchObject({ amountPaise: 99_900, phone: '9900000301' });
    expect((await c.employer!.get('/employer/subscription')).body.plan).toBe(before);
  });

  it('verifying before paying says pending; someone else cannot verify it', async () => {
    expect((await c.employer!.post(`/payments/${orderId}/verify`, {})).body).toMatchObject({ status: 'pending' });
    cf.pay(orderId, { status: 'FAILED' });
    expect((await c.employer!.post(`/payments/${orderId}/verify`, {})).body).toMatchObject({ status: 'pending' });
    expect((await c.employerB!.post(`/payments/${orderId}/verify`, {})).status).toBe(404);
  });

  it('a successful payment starts the plan, once, recorded as Cashfree', async () => {
    const pid = cf.pay(orderId, { group: 'credit_card' });
    const r = await c.employer!.post(`/payments/${orderId}/verify`, {});
    expect(r.body).toMatchObject({ status: 'paid', purpose: 'plan', paymentId: expect.any(String) });
    expect((await c.employer!.get('/employer/subscription')).body).toMatchObject({ plan: 'starter', cycle: 'monthly', paymentMode: 'cashfree' });
    expect((await c.employer!.post(`/payments/${orderId}/verify`, {})).body).toEqual(r.body);
    const rows = await ctx.db.selectFrom('subscription_payments').select(['provider', 'provider_payment_id', 'method']).where('provider', '=', 'cashfree').execute();
    expect(rows).toEqual([{ provider: 'cashfree', provider_payment_id: pid, method: 'card' }]);
    expect((await ctx.db.selectFrom('payment_orders').select('provider').where('id', '=', orderId).executeTakeFirstOrThrow()).provider).toBe('cashfree');
  });

  it('a short payment starts nothing', async () => {
    const o = (await c.employerB!.post('/employer/subscription/checkout', { plan: 'growth', cycle: 'yearly', acceptTerms: true })).body;
    cf.pay(o.orderId, { rupees: 1 });
    expect((await c.employerB!.post(`/payments/${o.orderId}/verify`, {})).status).toBe(409);
  });
});

describe('course fee and webhook', () => {
  const hook = (body: object, sig?: string) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/cashfree/webhook',
      headers: { 'content-type': 'application/json', 'x-webhook-timestamp': ts, 'x-webhook-signature': sig ?? signCashfreeForTests(cf.webhookSecret, ts, raw) },
      payload: raw,
    });
  };

  it('the seat is confirmed by the webhook even if the browser never came back; repeats do nothing', async () => {
    const o = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, acceptTerms: true });
    expect(o.status).toBe(201);
    expect(o.body.provider).toBe('cashfree');
    const pid = cf.pay(o.body.orderId);
    const event = { type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: o.body.orderId }, payment: { cf_payment_id: Number(pid), payment_status: 'SUCCESS' } } };
    expect((await hook(event, 'bad')).statusCode).toBe(400);
    expect((await hook(event)).statusCode).toBe(200);
    const order = await ctx.db.selectFrom('payment_orders').selectAll().where('id', '=', o.body.orderId).executeTakeFirstOrThrow();
    expect(order).toMatchObject({ status: 'paid', provider_payment_id: pid });
    expect((await hook(event)).json()).toEqual({ ok: true, duplicate: true });
    const v = await c.learner!.post(`/payments/${o.body.orderId}/verify`, {});
    expect(v.body).toMatchObject({ status: 'paid', purpose: 'course', enrolmentId: order.result_id });
    const rec = (await c.learner!.get(`/me/enrolments/${order.result_id}/receipt`)).body;
    expect(rec).toMatchObject({ amountRupees: 4999, test: false, status: 'enrolled', method: 'upi' });
  });

  it('the Razorpay webhook is switched off while Cashfree is in use', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/payments/razorpay/webhook', headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'a'.repeat(64) }, payload: '{}' });
    expect(r.statusCode).toBe(503);
  });
});
