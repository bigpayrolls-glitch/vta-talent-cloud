import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Accommodation with food (29 Oct 2026): offered per course; learners say whether they need it when enrolling. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const pub = (url: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}` });

beforeAll(async () => {
  ctx = await setup();
  c.learner = await loginPhone(ctx, PHONE.learner);
  c.admin = await loginEmail(ctx, EMAIL.secondAdmin);
});
afterAll(() => ctx.close());

describe('accommodation with food', () => {
  it('is off until a course offers it; asking for it then is refused', async () => {
    expect((await pub(`/public/courses/${ctx.ids.course2w}`)).json()).toMatchObject({ stayAvailable: false, stayFeeRupees: null });
    const r = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi', needsStay: true, acceptTerms: true });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.needsStay).toBe('Not offered for this course');
  });

  it('Admin offers it with the charge still to be confirmed; a learner who needs it pays the course fee only, and the need is recorded', async () => {
    expect((await c.admin!.patch(`/admin/courses/${ctx.ids.course2w}`, { stayAvailable: true, stayFeeRupees: null })).status).toBe(200);
    const course = (await c.admin!.get(`/courses/${ctx.ids.course2w}`)).body;
    expect(course).toMatchObject({ stayAvailable: true, stayFeeRupees: null, feeRupees: 4999 }); // the fee did not change
    expect((await c.learner!.get(`/me/enrol/${ctx.ids.batchOpen2w}`)).body.course).toMatchObject({ stayAvailable: true, stayFeeRupees: null });
    const r = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi', needsStay: true, acceptTerms: true });
    expect(r.status).toBe(201);
    const receipt = (await c.learner!.get(`/me/enrolments/${r.body.enrolmentId}/receipt`)).body;
    expect(receipt).toMatchObject({ amountRupees: 4999, stayRupees: 0, needsStay: true });
    const roster = (await c.admin!.get(`/batches/${ctx.ids.batchOpen2w}/roster`)).body;
    expect(roster.items.find((x: { enrolmentId: string }) => x.enrolmentId === r.body.enrolmentId)).toMatchObject({ needsStay: true });
    await ctx.db.updateTable('enrolments').set({ status: 'withdrawn', withdrawn_at: new Date() }).where('id', '=', r.body.enrolmentId).execute();
  });

  it('with a charge set, it is added to what the learner pays; not needed adds nothing', async () => {
    expect((await c.admin!.patch(`/admin/courses/${ctx.ids.course2w}`, { stayFeeRupees: 3000 })).status).toBe(200);
    expect((await pub(`/public/courses/${ctx.ids.course2w}`)).json()).toMatchObject({ stayAvailable: true, stayFeeRupees: 3000 });
    const r = await c.learner!.post('/me/enrolments', { batchId: ctx.ids.batchOpen2w, method: 'upi', needsStay: true, acceptTerms: true });
    expect(r.status).toBe(201);
    expect((await c.learner!.get(`/me/enrolments/${r.body.enrolmentId}/receipt`)).body).toMatchObject({ amountRupees: 7999, stayRupees: 3000, needsStay: true });
  });
});
