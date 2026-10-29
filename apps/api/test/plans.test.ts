import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

/** Admin > Plans (29 Oct 2026): plan prices, limits and features are kept in the database and can be changed. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const pub = (url: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}` });

beforeAll(async () => {
  ctx = await setup();
  c.admin = await loginEmail(ctx, EMAIL.secondAdmin);
  c.employer = await loginEmail(ctx, EMAIL.employerAdminA);
});
afterAll(() => ctx.close());

const starter = {
  name: 'Starter',
  tagline: 'For workshops',
  price: { monthly: 1199, yearly: 11_990 },
  activeJobs: 5,
  applicants: { limit: 40, per: 'month' },
  contactDetails: true,
  interviews: true,
  search: { results: null, profileViews: 60, invites: 25, allFilters: true },
  features: ['Up to 5 active jobs', 'Up to 40 applicants per month'],
};

describe('plans', () => {
  it('anyone can read the plans; they start as the site had them', async () => {
    const r = (await pub('/plans')).json();
    expect(r.employer.starter).toMatchObject({ name: 'Starter', price: { monthly: 99_900, yearly: 999_900 }, activeJobs: 3 });
  });

  it('only Admins can change a plan; the Free plan cannot have a price', async () => {
    expect((await c.employer!.put('/admin/plans/employer/starter', starter)).status).toBe(403);
    const free = await c.admin!.put('/admin/plans/employer/free', { ...starter, name: 'Free', price: { monthly: 10, yearly: 0 } });
    expect(free.status).toBe(400);
    expect(free.body.error.fields.price).toBe('Free costs nothing');
  });

  it('a change takes effect at once: price at checkout, limits and the plans page; it is audited', async () => {
    const r = await c.admin!.put('/admin/plans/employer/starter', starter);
    expect(r.status).toBe(200);
    expect(r.body.employer.starter).toMatchObject({ price: { monthly: 119_900, yearly: 1_199_000 }, activeJobs: 5, features: ['Up to 5 active jobs', 'Up to 40 applicants per month'] });
    expect((await pub('/plans')).json().employer.starter.search.profileViews).toBe(60);
    const pay = await c.employer!.post('/employer/subscription/checkout', { plan: 'starter', cycle: 'monthly', method: 'upi', acceptTerms: true });
    expect(pay.status).toBe(201);
    const invoice = (await c.employer!.get('/employer/subscription/payments')).body.items[0];
    expect(invoice).toMatchObject({ plan: 'starter', amountPaise: 119_900 });
    expect((await c.employer!.get('/employer/subscription')).body.usage).toMatchObject({ activeJobsLimit: 5, applicantsLimit: 40 });
    const a = await ctx.db.selectFrom('audit_events').select(['after']).where('action', '=', 'plan.updated').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(a.after).toMatchObject({ code: 'starter', activeJobs: 5 });
  });
});
