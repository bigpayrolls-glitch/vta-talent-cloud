import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

/** Training partner Subscription & Billing (29 Oct 2026): plans, limits, checkout with GST, invoices, Admin. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const batch = (n: number) => ({ name: `EV Mysuru plan test ${n}`, courseId: ctx.ids.courseEv, centreId: ctx.ids.centrePartnerB, trainerId: ctx.ids.trainerB, startDate: '2027-02-01', endDate: '2027-03-01', capacity: 5 });

beforeAll(async () => {
  ctx = await setup();
  c.admin = await loginEmail(ctx, EMAIL.secondAdmin);
  c.partnerB = await loginEmail(ctx, EMAIL.partnerAdminB);
  c.employer = await loginEmail(ctx, EMAIL.employerAdminA);
});
afterAll(() => ctx.close());

describe('training partner plans', () => {
  it('Admin puts a partner on Free; the partner sees its plan and what it uses', async () => {
    const set = await c.admin!.post(`/admin/organisations/${ctx.ids.partnerB}/subscription`, { plan: 'free', reason: 'Plan test' });
    expect(set.status).toBe(200);
    expect((await c.admin!.post(`/admin/organisations/${ctx.ids.partnerB}/subscription`, { plan: 'growth', months: 1, reason: 'Wrong kind' })).status).toBe(400);
    const s = (await c.partnerB!.get('/partner/subscription')).body;
    expect(s).toMatchObject({ plan: 'free', usage: { activeBatchesLimit: 1, activeCoursesLimit: 2, learnersLimit: 50 } });
    expect((await c.employer!.get('/partner/subscription')).status).toBe(403);
  });

  it('on Free, a second active batch is refused with an upgrade message', async () => {
    const used = (await c.partnerB!.get('/partner/subscription')).body.usage.activeBatches;
    if (used < 1) expect((await c.partnerB!.post('/admin/batches', batch(1))).status).toBe(201);
    const r = await c.partnerB!.post('/admin/batches', batch(2));
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ message: expect.stringMatching(/^Your Free plan allows 1 active batch/), fields: { plan: 'upgrade' } });
  });

  it('paying for Professional adds 18% GST, starts the plan and makes an invoice; the batch is then allowed', async () => {
    const pay = await c.partnerB!.post('/partner/subscription/checkout', { plan: 'professional', cycle: 'monthly', method: 'upi', acceptTerms: true });
    expect(pay.status).toBe(201);
    const items = (await c.partnerB!.get('/partner/subscription/payments')).body.items;
    expect(items[0]).toMatchObject({ plan: 'professional', amountPaise: 176_900, gstPaise: 27_000, test: true });
    expect((await c.partnerB!.get(`/partner/subscription/payments/${items[0].id}`)).body).toMatchObject({ invoiceNumber: expect.stringMatching(/^INV-/), company: { name: 'Velocity Training Academy (demo)' } });
    expect((await c.partnerB!.get('/partner/subscription')).body).toMatchObject({ plan: 'professional', status: 'active', usage: { activeBatchesLimit: 10 } });
    expect((await c.partnerB!.post('/admin/batches', batch(3))).status).toBe(201);
  });

  it('Admin changes a partner plan; the price at checkout follows', async () => {
    const plans = (await c.admin!.get('/admin/plans')).body.partner;
    const pro = plans.professional;
    const body = { ...pro, price: { monthly: 1999, yearly: 19_999 }, gstPct: 18 };
    expect((await c.partnerB!.put('/admin/plans/partner/professional', body)).status).toBe(403);
    expect((await c.admin!.put('/admin/plans/partner/professional', body)).status).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/plans' })).json().partner.professional.price).toEqual({ monthly: 199_900, yearly: 1_999_900 });
    await c.partnerB!.post('/partner/subscription/checkout', { plan: 'professional', cycle: 'yearly', method: 'card', acceptTerms: true });
    const latest = (await c.partnerB!.get('/partner/subscription/payments')).body.items[0];
    expect(latest).toMatchObject({ cycle: 'yearly', amountPaise: 1_999_900 + 360_000, gstPaise: 360_000 });
  });
});
