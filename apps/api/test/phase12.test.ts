import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { newId } from '../src/lib/crypto.js';
import { addPeriod } from '../src/lib/subscriptions.js';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

/** Phase 12: employer plans, limits, test payments and invoices. */
let ctx: Ctx;
const c: Record<string, Client> = {};
let orgA = '';

beforeAll(async () => {
  ctx = await setup();
  c.ops = await loginEmail(ctx, EMAIL.secondAdmin);
  c.adminA = await loginEmail(ctx, EMAIL.employerAdminA);
  c.partnerA = await loginEmail(ctx, EMAIL.partnerAdminA);
  c.adminB = await loginEmail(ctx, EMAIL.employerAdminB);
  c.pending = await loginEmail(ctx, EMAIL.employerAdminPending);
  orgA = (await ctx.db.selectFrom('jobs').select('organisation_id').where('id', '=', ctx.ids.job2wA!).executeTakeFirstOrThrow()).organisation_id;
});
afterAll(() => ctx.close());

const setPlan = (plan: string, months?: number) => c.ops!.post(`/admin/organisations/${orgA}/subscription`, { plan, months, reason: 'Phase 12 test' });

describe('the current plan', () => {
  it('the employer sees the plan, usage and how payment works', async () => {
    const s = (await c.adminA!.get('/employer/subscription')).body;
    expect(s).toMatchObject({ plan: 'growth', status: 'active', source: 'admin', paymentMode: 'test' });
    expect(s.usage).toMatchObject({ activeJobs: 1, activeJobsLimit: 10, applicantsLimit: 100, applicantsPer: 'month' });
    expect(s.usage.teamMembers).toBe(1); // one login per employer
    expect(s.usage.resetsOn).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('an employer with no plan, or whose plan ended, is on Free', async () => {
    expect((await c.pending!.get('/employer/subscription')).body).toMatchObject({ plan: 'free', status: 'free', lastPaidPlan: null });
    const orgB = (await ctx.db.selectFrom('jobs').select('organisation_id').where('id', '=', ctx.ids.jobEvB!).executeTakeFirstOrThrow()).organisation_id;
    await ctx.db.updateTable('employer_subscriptions').set({ period_start: new Date(Date.now() - 60 * 86_400_000), period_end: new Date(Date.now() - 1000) }).where('organisation_id', '=', orgB).execute();
    expect((await c.adminB!.get('/employer/subscription')).body).toMatchObject({ plan: 'free', status: 'expired', lastPaidPlan: 'starter' });
  });
});

describe('Free plan limits', () => {
  beforeAll(async () => {
    expect((await setPlan('free')).status).toBe(200);
  });

  it('only one job can be active: sending a second one for review is refused with an upgrade hint', async () => {
    const r = await c.adminA!.post(`/employer/jobs/${ctx.ids.jobDraftA}/submit`);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/Free plan allows 1 active job/);
    expect(r.body.error.fields).toEqual({ plan: 'upgrade' });
  });

  it('contact details and interviews need a paid plan; the name is still shown', async () => {
    const app = (await c.adminA!.get(`/employer/applications/${ctx.ids.applicationAnitha}`)).body;
    expect(app.candidate).toMatchObject({ phone: null, email: null, contactShared: false, contactNeedsUpgrade: true });
    expect(app.candidate.name).not.toBe('Withdrawn applicant');
    expect(app.interviewsOnPlan).toBe(false);
    const viewed = await ctx.db.selectFrom('audit_events').select('id').where('action', '=', 'application.contact_viewed').where('actor_id', 'is not', null).execute();
    const before = viewed.length;
    await c.adminA!.get(`/employer/applications/${ctx.ids.applicationAnitha}`);
    expect((await ctx.db.selectFrom('audit_events').select('id').where('action', '=', 'application.contact_viewed').execute()).length).toBe(before); // nothing shown, nothing logged
    const iv = await c.adminA!.post(`/employer/applications/${ctx.ids.applicationAnitha}/interviews`, { scheduledAt: '2026-11-20T11:00:00+05:30', mode: 'phone' });
    expect(iv.status).toBe(403);
    expect(iv.body.error.message).toMatch(/Starter plan and above/);
  });

  it('beyond 3 applicants on a job, the rest are hidden and cannot be opened until an upgrade', async () => {
    const others = await ctx.db
      .selectFrom('candidate_profiles')
      .select('user_id')
      .where('user_id', 'not in', ctx.db.selectFrom('job_applications').select('candidate_id').where('job_id', '=', ctx.ids.job2wA!))
      .limit(3)
      .execute();
    expect(others).toHaveLength(3);
    const base = Date.now();
    for (const [i, o] of others.entries()) {
      await ctx.db
        .insertInto('job_applications')
        .values({ id: newId(), job_id: ctx.ids.job2wA!, candidate_id: o.user_id, consent_snapshot: JSON.stringify({ test: true }), applied_at: new Date(base + i * 1000) })
        .execute();
    }
    const list = (await c.adminA!.get(`/employer/jobs/${ctx.ids.job2wA}/applications`)).body;
    expect(list.items).toHaveLength(4);
    expect(list.lockedCount).toBe(1);
    const hidden = list.items.find((a: { locked: boolean }) => a.locked);
    expect(hidden).toMatchObject({ name: 'Hidden applicant', city: null, skillAreas: [] });
    const open = await c.adminA!.get(`/employer/applications/${hidden.id}`);
    expect(open.status).toBe(403);
    expect(open.body.error.message).toMatch(/3 applicants per job/);
    expect((await c.adminA!.post(`/employer/applications/${hidden.id}/move`, { to: 'shortlisted' })).status).toBe(403);
  });
});

describe('buying a plan (test payment)', () => {
  let paymentId = '';
  let firstEnd = '';

  it('only the employer can pay; the terms must be accepted; an unverified company cannot pay yet', async () => {
    const body = { plan: 'starter', cycle: 'monthly', method: 'upi', acceptTerms: true };
    expect((await c.partnerA!.post('/employer/subscription/checkout', body)).status).toBe(403);
    const noTerms = await c.adminA!.post('/employer/subscription/checkout', { ...body, acceptTerms: false });
    expect(noTerms.status).toBe(400);
    expect(noTerms.body.error.fields.acceptTerms).toBe('Accept the terms to continue');
    const pending = await c.pending!.post('/employer/subscription/checkout', body);
    expect(pending.status).toBe(403);
    expect(pending.body.error.message).toMatch(/verify your company first/);
  });

  it('paying for Starter makes it active at once, issues an invoice and reveals the hidden applicant', async () => {
    const r = await c.adminA!.post('/employer/subscription/checkout', { plan: 'starter', cycle: 'monthly', method: 'card', acceptTerms: true });
    expect(r.status).toBe(201);
    expect(r.body.invoiceNumber).toMatch(/^INV-\d{8}-\d{4}$/);
    paymentId = r.body.paymentId;
    const s = (await c.adminA!.get('/employer/subscription')).body;
    expect(s).toMatchObject({ plan: 'starter', cycle: 'monthly', status: 'active', source: 'payment' });
    firstEnd = s.periodEnd;
    const days = (new Date(s.periodEnd).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    const list = (await c.adminA!.get(`/employer/jobs/${ctx.ids.job2wA}/applications`)).body;
    expect(list.lockedCount).toBe(0);
    const app = (await c.adminA!.get(`/employer/applications/${ctx.ids.applicationAnitha}`)).body;
    expect(app.candidate.phone).toMatch(/^\+91/);
    expect(app.interviewsOnPlan).toBe(true);
  });

  it('the invoice is listed and opens with the company details, marked as a test payment', async () => {
    const items = (await c.adminA!.get('/employer/subscription/payments')).body.items;
    expect(items[0]).toMatchObject({ id: paymentId, plan: 'starter', cycle: 'monthly', amountPaise: 99_900, method: 'card', test: true });
    const inv = (await c.adminA!.get(`/employer/subscription/payments/${paymentId}`)).body;
    expect(inv.company.name).toBe('Sunrise Two-Wheeler Service (demo)');
    expect(inv.paidByName).toBe('Rahul Employer A');
    expect((await c.adminB!.get(`/employer/subscription/payments/${paymentId}`)).status).toBe(404);
  });

  it('paying for the same plan again extends it from the end date; payments cannot be changed', async () => {
    await c.adminA!.post('/employer/subscription/checkout', { plan: 'starter', cycle: 'monthly', method: 'netbanking', acceptTerms: true });
    const s = (await c.adminA!.get('/employer/subscription')).body;
    expect(s.periodEnd).toBe(addPeriod(new Date(firstEnd), 'monthly').toISOString());
    await expect(sql`update subscription_payments set amount_paise = 1`.execute(ctx.db)).rejects.toThrow(/append-only/);
    const audits = await ctx.db.selectFrom('audit_events').select('after').where('action', '=', 'subscription.paid').where('entity_id', '=', orgA).execute();
    expect(audits).toHaveLength(2);
  });

  it('the employer admin is told when another admin pays (not the payer)', async () => {
    const n = (await c.adminA!.get('/notifications')).body.items.filter((x: { title: string }) => x.title === 'Your Starter plan is active');
    expect(n).toHaveLength(0);
  });
});

describe('AutoTalent Grid staff', () => {
  it('an Enterprise request reaches AutoTalent Grid staff', async () => {
    expect((await c.adminA!.post('/employer/subscription/request', { plan: 'enterprise', note: 'Twelve branches' })).status).toBe(200);
    const n = (await c.ops!.get('/notifications')).body.items[0];
    expect(n).toMatchObject({ title: 'Sunrise Two-Wheeler Service (demo) asked about the Enterprise plan', body: 'Their note: Twelve branches' });
  });

  it('staff set Enterprise for 12 months: no limits, the employer is told, and it is audited', async () => {
    expect((await c.adminA!.post(`/admin/organisations/${orgA}/subscription`, { plan: 'enterprise', reason: 'x' })).status).toBe(403);
    expect((await setPlan('enterprise')).body).toBeDefined();
    const r = await c.ops!.post(`/admin/organisations/${orgA}/subscription`, { plan: 'enterprise', months: 12, reason: 'Signed agreement' });
    expect(r.body).toMatchObject({ plan: 'enterprise', source: 'admin', usage: { activeJobsLimit: null, applicantsLimit: null } });
    const n = (await c.adminA!.get('/notifications')).body.items[0];
    expect(n.title).toBe('AutoTalent Grid set your plan to Enterprise');
    const enterpriseCheckout = await c.adminA!.post('/employer/subscription/checkout', { plan: 'growth', cycle: 'monthly', method: 'upi', acceptTerms: true });
    expect(enterpriseCheckout.status).toBe(409);
    const view = (await c.ops!.get(`/admin/organisations/${orgA}/subscription`)).body;
    expect(view.payments).toHaveLength(2);
    const audit = await ctx.db.selectFrom('audit_events').select('after').where('action', '=', 'subscription.set').where('entity_id', '=', orgA).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(audit.after).toMatchObject({ plan: 'enterprise', reason: 'Signed agreement' });
  });
});

describe('payment settings', () => {
  it('test payments are refused in production; production defaults to asking AutoTalent Grid', () => {
    expect(() => loadConfig({ APP_ENV: 'production', PAYMENT_MODE: 'test' })).toThrow(/PAYMENT_MODE=test/);
    expect(loadConfig({ APP_ENV: 'production' }).paymentMode).toBe('none');
    expect(loadConfig({ APP_ENV: 'staging' }).paymentMode).toBe('test');
  });

  it('addPeriod keeps the day of the month where it exists', () => {
    expect(addPeriod(new Date('2026-01-31T10:00:00Z'), 'monthly').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addPeriod(new Date('2026-10-26T10:00:00Z'), 'yearly').toISOString()).toBe('2027-10-26T10:00:00.000Z');
  });
});
