import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

/** Candidate search limits by plan (29 Oct 2026). Employer A is moved between plans by hand here. */
let ctx: Ctx;
let employer: Client;
let ids: string[] = [];

const setPlan = async (plan: 'free' | 'starter') => {
  await ctx.db.deleteFrom('employer_subscriptions').where('organisation_id', '=', ctx.ids.employerA!).execute();
  if (plan === 'starter') {
    await ctx.db
      .insertInto('employer_subscriptions')
      .values({ organisation_id: ctx.ids.employerA!, plan: 'starter', billing_cycle: 'monthly', period_start: new Date(Date.now() - 86_400_000), period_end: new Date(Date.now() + 30 * 86_400_000), source: 'admin', updated_by: ctx.ids.superAdmin! })
      .execute();
  }
};

beforeAll(async () => {
  ctx = await setup();
  const admin = await loginEmail(ctx, EMAIL.secondAdmin);
  const rows = Array.from({ length: 30 }, (_, i) => `Search Person ${i},${9500000000 + i},Hubballi,2W,${i}`);
  await admin.post('/admin/candidates/import', { csv: ['name,phone,city,skill_areas,experience_months', ...rows].join('\n'), commit: true });
  employer = await loginEmail(ctx, EMAIL.employerAdminA);
  await setPlan('free');
  ids = (await ctx.db.selectFrom('users').select('id').where('phone', 'like', '+9195000000%').orderBy('phone').execute()).map((u) => u.id);
});
afterAll(() => ctx.close());

describe('Free plan', () => {
  it('shows only the first 20 results of a search, and only that more match (not how many)', async () => {
    const r = (await employer.get('/employer/candidates?city=Hubballi&pageSize=50')).body;
    expect(r.items).toHaveLength(20);
    expect(r).toMatchObject({ matched: null, more: true, limitedTo: 20, total: 20 });
    expect((await employer.get('/employer/candidates?city=Hubballi&pageSize=20&page=2')).body.items).toHaveLength(0);
  });

  it('keeps experience and certificate filters for paid plans', async () => {
    const r = await employer.get('/employer/candidates?minExperienceMonths=12');
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ message: 'Experience and certificate filters are in the Starter plan and above.', fields: { plan: 'limit' } });
    expect((await employer.get('/employer/candidates?skillArea=2W&city=Hubballi')).status).toBe(200);
  });

  it('5 profile views a month; opening the same profile again is free', async () => {
    for (const id of ids.slice(0, 5)) expect((await employer.get(`/employer/candidates/${id}`)).status).toBe(200);
    // No contact details on Free; the name stays shortened.
    expect((await employer.get(`/employer/candidates/${ids[0]}`)).body).toMatchObject({ name: 'Search 0.', phone: null, email: null, contactNeedsUpgrade: true });
    expect((await employer.get(`/employer/candidates/${ids[0]}`)).status).toBe(200);
    const sixth = await employer.get(`/employer/candidates/${ids[5]}`);
    expect(sixth.status).toBe(403);
    expect(sixth.body.error.message).toMatch(/opened 5 candidate profiles this month, the limit of your Free plan/);
    const u = (await employer.get('/employer/candidates/usage')).body;
    expect(u).toMatchObject({ plan: 'free', results: 20, allFilters: false, profileViews: { used: 5, limit: 5 }, invites: { used: 0, limit: 2 } });
    expect(u.resetsOn).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('2 invites a month', async () => {
    for (const id of ids.slice(0, 2)) expect((await employer.post(`/employer/candidates/${id}/invite`, { jobId: ctx.ids.job2wA })).status).toBe(201);
    const third = await employer.post(`/employer/candidates/${ids[2]}/invite`, { jobId: ctx.ids.job2wA });
    expect(third.status).toBe(403);
    expect(third.body.error.message).toMatch(/sent 2 invitations this month/);
  });
});

describe('Starter plan', () => {
  it('all results and filters, 50 views and 20 invites a month (this month\'s use carries over)', async () => {
    await setPlan('starter');
    const r = (await employer.get('/employer/candidates?city=Hubballi&pageSize=50')).body;
    expect(r.items).toHaveLength(30);
    expect(r.limitedTo).toBeNull();
    expect((await employer.get('/employer/candidates?city=Hubballi&minExperienceMonths=12')).body.items).toHaveLength(18);
    expect(r).toMatchObject({ matched: 30, more: false });
    const p = await employer.get(`/employer/candidates/${ids[5]}`);
    expect(p.status).toBe(200);
    // Starter includes contact details: full name and mobile, and the reveal is logged.
    expect(p.body).toMatchObject({ name: 'Search Person 5', phone: '+919500000005', contactNeedsUpgrade: false });
    const logged = await ctx.db.selectFrom('audit_events').select('entity_id').where('action', '=', 'candidate.contact_viewed').execute();
    expect(logged.map((l) => l.entity_id)).toContain(ids[5]);
    expect((await employer.get('/employer/candidates/usage')).body).toMatchObject({ plan: 'starter', profileViews: { used: 6, limit: 50 }, invites: { used: 2, limit: 20 } });
  });
});
