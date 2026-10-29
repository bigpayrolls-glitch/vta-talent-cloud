import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../src/lib/crypto.js';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** AutoTalent Grid career journeys (29 Oct 2026): enrol and pay for the course; AutoTalent Grid assigns the batch. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const pub = (url: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}` });
let step1 = '';
let step2 = '';

beforeAll(async () => {
  ctx = await setup();
  c.learner = await loginPhone(ctx, PHONE.learner);
  c.admin = await loginEmail(ctx, EMAIL.secondAdmin);
  const ids = await ctx.db.selectFrom('courses').select(['id', 'code']).where('code', 'in', ['ATG-TECH-1', 'ATG-TECH-2']).execute();
  step1 = ids.find((x) => x.code === 'ATG-TECH-1')!.id;
  step2 = ids.find((x) => x.code === 'ATG-TECH-2')!.id;
});
afterAll(() => ctx.close());

describe('career journey courses', () => {
  it('the 16 courses are there, switched off with no fee until an Admin sets them', async () => {
    const all = await ctx.db.selectFrom('courses').select(['code', 'title', 'status', 'fee_paise', 'track', 'track_step', 'duration_value']).where('track', 'is not', null).orderBy('code').execute();
    expect(all).toHaveLength(16);
    expect(all.every((x) => x.status === 'inactive' && x.fee_paise === 0)).toBe(true);
    expect(all.find((x) => x.code === 'ATG-TECH-1')).toMatchObject({ title: 'Technician Beginner: 7 Brands 18 Points Check Up', track: 'technician', track_step: 1, duration_value: 30 });
    expect(all.find((x) => x.code === 'ATG-FS-4')).toMatchObject({ title: 'Floor Supervisor Expert: Leadership and Advanced Operations', duration_value: 15 });
    expect((await pub('/public/courses')).json().items.some((i: { track: string | null }) => i.track)).toBe(false);
  });

  it('once switched on with a fee, a journey course is listed without a batch, first, with its step', async () => {
    await c.admin!.patch(`/admin/courses/${step1}`, { feeRupees: 2000 });
    await c.admin!.patch(`/admin/courses/${step2}`, { feeRupees: 1500 });
    expect((await c.admin!.post(`/admin/courses/${step1}/activate`)).status).toBe(200);
    expect((await c.admin!.post(`/admin/courses/${step2}/activate`)).status).toBe(200);
    const items = (await pub('/public/courses')).json().items;
    expect(items[0]).toMatchObject({ id: step1, track: 'technician', trackStep: 1, feeRupees: 2000, batchCount: 0, nextBatchId: null });
    expect(items[1]).toMatchObject({ id: step2, trackStep: 2 });
    // Courses with a ready-made picture use it; the others fall back to the skill picture on screen.
    const sa1 = await ctx.db.selectFrom('courses').selectAll().where('code', '=', 'ATG-SA-1').executeTakeFirstOrThrow();
    expect((await c.admin!.get(`/courses/${sa1.id}`)).body.imageUrl).toBe('/courses/journeys/ATG-SA-1.webp');
    expect(items[0].imageUrl).toBe('/courses/journeys/ATG-TECH-1.webp');
    const d = (await pub(`/public/courses/${step2}`)).json();
    expect(d.journey).toMatchObject({ track: 'technician', step: 2, previous: { id: step1 } });
  });

  it('step 2 opens only after step 1 is complete', async () => {
    const q = (await c.learner!.get(`/me/book/${step2}`)).body;
    expect(q.blocker).toMatch(/^Complete Technician Beginner: 7 Brands 18 Points Check Up first/);
    expect((await c.learner!.post('/me/bookings', { courseId: step2, method: 'upi', acceptTerms: true })).status).toBe(409);
  });

  let bookingId = '';
  it('the learner enrols and pays for step 1; it waits for a batch; Admins are told', async () => {
    expect((await c.learner!.get(`/me/book/${step1}`)).body).toMatchObject({ blocker: null, course: { feeRupees: 2000, journey: { step: 1, previous: null } } });
    const r = await c.learner!.post('/me/bookings', { courseId: step1, method: 'upi', acceptTerms: true });
    expect(r.status).toBe(201);
    bookingId = r.body.bookingId;
    expect((await c.learner!.get(`/me/bookings/${bookingId}/receipt`)).body).toMatchObject({ amountRupees: 2000, status: 'awaiting_batch', test: true });
    expect((await c.learner!.get('/me/bookings')).body.items[0]).toMatchObject({ status: 'awaiting_batch', batch: null });
    expect((await c.learner!.post('/me/bookings', { courseId: step1, method: 'upi', acceptTerms: true })).body.error.message).toMatch(/already enrolled/);
    const list = (await c.admin!.get('/admin/bookings')).body.items;
    expect(list.find((x: { id: string }) => x.id === bookingId)).toMatchObject({ amountRupees: 2000, course: { id: step1 }, learner: { id: ctx.ids.learner } });
    const n = await ctx.db.selectFrom('notifications').select('template').where('template', '=', 'course_booked').execute();
    expect(n.length).toBeGreaterThan(0);
  });

  it('an Admin places the learner in a batch of the course; the learner is told', async () => {
    expect((await c.admin!.get(`/admin/bookings/${bookingId}/batches`)).body.items).toEqual([]);
    const template = await ctx.db.selectFrom('batches').selectAll().where('id', '=', ctx.ids.batchOpen2w!).executeTakeFirstOrThrow();
    const batchId = newId();
    await ctx.db.insertInto('batches').values({ ...template, id: batchId, name: 'Technician Beginner Peenya', course_id: step1, capacity: 10 }).execute();
    expect((await c.admin!.get(`/admin/bookings/${bookingId}/batches`)).body.items).toEqual([expect.objectContaining({ id: batchId, seatsLeft: 10 })]);
    expect((await c.admin!.post(`/admin/bookings/${bookingId}/assign`, { batchId: ctx.ids.batchOpen2w })).status).toBe(400);
    const r = await c.admin!.post(`/admin/bookings/${bookingId}/assign`, { batchId });
    expect(r.status).toBe(200);
    expect((await c.learner!.get('/me/bookings')).body.items[0]).toMatchObject({ status: 'placed', batch: { name: 'Technician Beginner Peenya' } });
    expect((await ctx.db.selectFrom('notifications').select('template').where('user_id', '=', ctx.ids.learner!).where('template', '=', 'booking_placed').execute()).length).toBe(1);
    expect((await c.admin!.post(`/admin/bookings/${bookingId}/assign`, { batchId })).status).toBe(409);
    // Completing step 1 opens step 2.
    await ctx.db.updateTable('enrolments').set({ status: 'completed' }).where('id', '=', r.body.enrolmentId).execute();
    expect((await c.learner!.get(`/me/book/${step2}`)).body.blocker).toBeNull();
  });
});
