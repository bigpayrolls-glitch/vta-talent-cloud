import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 13: public course catalogue and learner self-enrolment with a (test) payment. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const pub = (url: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}` });

beforeAll(async () => {
  ctx = await setup();
  c.learner = await loginPhone(ctx, PHONE.learner);
  c.admin = await loginEmail(ctx, EMAIL.secondAdmin);
  c.partnerA = await loginEmail(ctx, EMAIL.partnerAdminA);
  c.employer = await loginEmail(ctx, EMAIL.employerAdminA);
});
afterAll(() => ctx.close());

describe('public catalogue', () => {
  it('lists active courses with batches that have not started, with fee, centre and provider; no sign-in needed', async () => {
    const r = await pub('/public/courses');
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(['2W Service Technician', '4W Service Technician', 'EV Technician']);
    const tw = body.items[0];
    expect(tw).toMatchObject({ feeRupees: 4999, nextStart: '2026-11-10', batchCount: 1, providers: ['Skill Bridge Foundation (demo)'], cities: ['Bengaluru'] });
    expect(body.items[1].providers).toEqual(['AutoTalent Grid']);
    expect(body.cities).toEqual(['Bengaluru', 'Mysuru']);
  });

  it('filters by city, category, fee and duration, and sorts by fee', async () => {
    const titles = async (qs: string) => (await pub(`/public/courses?${qs}`)).json().items.map((i: { title: string }) => i.title);
    expect(await titles('city=Mysuru')).toEqual(['EV Technician']);
    expect(await titles('skill=EV,4W')).toEqual(['4W Service Technician', 'EV Technician']);
    expect(await titles('fee=upto5k')).toEqual(['2W Service Technician']);
    expect(await titles('duration=1to3m')).toEqual(['2W Service Technician']);
    expect(await titles('sort=fee_desc')).toEqual(['EV Technician', '4W Service Technician', '2W Service Technician']);
    expect((await pub('/public/courses?skill=XX')).statusCode).toBe(400);
  });

  it('a course page shows the skills taught and open batches with seats, and no one\'s name', async () => {
    const r = await pub(`/public/courses/${ctx.ids.course2w}`);
    const d = r.json();
    expect(d.skills.map((s: { label: string }) => s.label)).toEqual(['Engine servicing', 'Electrical diagnosis', 'Brakes and suspension', 'Workshop safety']);
    expect(d.batches).toEqual([
      expect.objectContaining({ id: ctx.ids.batchOpen2w, name: '2W Peenya November 2026', seatsLeft: 20, capacity: 20, centre: expect.any(String), provider: 'Skill Bridge Foundation (demo)' }),
    ]);
    expect(r.body).not.toMatch(/Trainer|Ravi|Anitha/);
    await ctx.db.updateTable('courses').set({ status: 'inactive' }).where('id', '=', ctx.ids.course4w!).execute();
    expect((await pub(`/public/courses/${ctx.ids.course4w}`)).statusCode).toBe(404);
    await ctx.db.updateTable('courses').set({ status: 'active' }).where('id', '=', ctx.ids.course4w!).execute();
  });
});

describe('learner self-enrolment', () => {
  let enrolmentId = '';

  it('shows what the learner will enrol in and pay', async () => {
    const q = (await c.learner!.get(`/me/enrol/${ctx.ids.batchOpen2w}`)).body;
    expect(q).toMatchObject({ blocker: null, paymentMode: 'test', course: { title: '2W Service Technician', feeRupees: 4999 }, batch: { seatsLeft: 20 } });
    expect((await c.learner!.get(`/me/enrol/${ctx.ids.batchA}`)).body.blocker).toBe('This batch is no longer open for enrolment.');
  });

  it('needs the terms and a payment method for a paid course', async () => {
    const noTerms = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi' });
    expect(noTerms.body.error.fields.acceptTerms).toBe('Accept the terms to continue');
    const noMethod = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, acceptTerms: true });
    expect(noMethod.body.error.fields.method).toBe('Choose how to pay');
    expect((await c.employer!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi', acceptTerms: true })).status).toBe(403);
  });

  it('paying enrols the learner at once with a receipt; the seat is taken and it shows in My learning', async () => {
    const r = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi', acceptTerms: true });
    expect(r.status).toBe(201);
    expect(r.body.receiptNumber).toMatch(/^ATG-ENR-\d{8}-\d{4}$/);
    enrolmentId = r.body.enrolmentId;
    const rec = (await c.learner!.get(`/me/enrolments/${enrolmentId}/receipt`)).body;
    expect(rec).toMatchObject({ amountRupees: 4999, method: 'upi', test: true, free: false, status: 'enrolled', course: { title: '2W Service Technician' }, batch: { startDate: '2026-11-10', provider: 'Skill Bridge Foundation (demo)' } });
    expect(rec.learner.code).toMatch(/^ATG\d{7}$/);
    expect((await pub(`/public/courses/${ctx.ids.course2w}`)).json().batches[0].seatsLeft).toBe(19);
    const learning = (await c.learner!.get('/me/learning')).body.items;
    expect(learning.some((i: { enrolmentId: string }) => i.enrolmentId === enrolmentId)).toBe(true);
    const e = await ctx.db.selectFrom('enrolments').select(['source', 'enrolled_by']).where('id', '=', enrolmentId).executeTakeFirstOrThrow();
    expect(e.source).toBe('self');
    const audit = await ctx.db.selectFrom('audit_events').select('after').where('action', '=', 'enrolment.self').executeTakeFirstOrThrow();
    expect(audit.after).toMatchObject({ enrolmentId, amount_paise: 499_900, provider: 'test' });
  });

  it('cannot enrol twice; payments cannot be changed; another person cannot open the receipt', async () => {
    const again = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi', acceptTerms: true });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('You are already enrolled in this batch.');
    await expect(sql`update course_payments set amount_paise = 1`.execute(ctx.db)).rejects.toThrow(/append-only/);
    const other = await loginPhone(ctx, '+919900000211');
    expect((await other.get(`/me/enrolments/${enrolmentId}/receipt`)).status).toBe(404);
  });

  it('a full batch is refused; whoever runs the centre hears about online enrolments', async () => {
    await ctx.db.updateTable('batches').set({ capacity: 1 }).where('id', '=', ctx.ids.batchVta!).execute(); // Deepa already has the one seat
    const full = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchVta, method: 'card', acceptTerms: true });
    expect(full.status).toBe(409);
    expect(full.body.error.message).toBe('This batch is full. Choose another batch.');
    await ctx.db.updateTable('batches').set({ capacity: 20 }).where('id', '=', ctx.ids.batchVta!).execute();
    expect((await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchVta, method: 'card', acceptTerms: true })).status).toBe(201);
    // AutoTalent Grid runs the Bengaluru centre, so its Admins are told.
    const n = (await c.admin!.get('/notifications')).body.items[0];
    expect(n.title).toMatch(/enrolled in 4W Bengaluru November 2026/);
    expect(n.body).toBe('They enrolled online and paid ₹9,999.');
    // Skill Bridge runs Peenya, so the training partner heard about the earlier enrolment there, and not about this one.
    const partner = (await c.partnerA!.get('/notifications')).body.items.map((x: { title: string }) => x.title);
    expect(partner.some((t: string) => /enrolled in 2W Peenya November 2026/.test(t))).toBe(true);
    expect(partner.some((t: string) => /4W Bengaluru/.test(t))).toBe(false);
  });

  it('a free course needs no payment method', async () => {
    await ctx.db.updateTable('courses').set({ fee_paise: 0 }).where('id', '=', ctx.ids.courseEv!).execute();
    const r = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchB, acceptTerms: true });
    expect(r.status).toBe(201);
    expect((await c.learner!.get(`/me/enrolments/${r.body.enrolmentId}/receipt`)).body).toMatchObject({ amountRupees: 0, free: true, test: false, method: null });
  });

  it('a learner who has not accepted the privacy notice, or is flagged as a possible duplicate, cannot enrol', async () => {
    const fresh = await loginPhone(ctx, '+919900000218');
    const r = await fresh.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi', acceptTerms: true });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Accept the privacy notice/);
    const learnerId = (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id;
    await ctx.db.updateTable('candidate_profiles').set({ duplicate_of: ctx.ids.cand1! }).where('user_id', '=', learnerId).execute();
    const dup = await c.learner!.get(`/me/enrol/${ctx.ids.batchOpen2w}`);
    await ctx.db.updateTable('candidate_profiles').set({ duplicate_of: null }).where('user_id', '=', learnerId).execute();
    expect(dup.body.blocker).toMatch(/checking your profile/);
  });
});
