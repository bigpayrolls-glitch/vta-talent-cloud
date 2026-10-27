import { NOTICE_VERSION } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, nextIp, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 9: in-app notifications (SH-07), password reset/change, learner data download and account closure. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const RAVI = '+919900000211';

const titles = async (client: Client) => ((await client.get('/notifications')).body.items as { title: string }[]).map((n) => n.title);
const count = async (userId: string, template: string) =>
  Number((await ctx.db.selectFrom('notifications').select((eb) => eb.fn.countAll<string>().as('n')).where('user_id', '=', userId).where('template', '=', template).executeTakeFirstOrThrow()).n);
const userId = async (email: string) => (await ctx.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;

beforeAll(async () => {
  ctx = await setup();
  for (const k of ['employerAdminA', 'employerAdminB', 'secondAdmin', 'superAdmin'] as const) c[k] = await loginEmail(ctx, EMAIL[k]);
  c.ravi = await loginPhone(ctx, RAVI);
  c.learner = await loginPhone(ctx, PHONE.learner);
  for (const purpose of ['privacy_notice', 'terms'] as const) await c.ravi.post('/me/consents', { purpose, granted: true, noticeVersion: NOTICE_VERSION });
});
afterAll(() => ctx.close());

describe('SH-07 notifications', () => {
  let jobId = '';
  let appId = '';

  it('a job sent for review reaches AutoTalent Grid reviewers; publishing it reaches the employer, never the person who acted', async () => {
    const job = await c.employerAdminA!.post('/employer/jobs', {
      title: 'Brake specialist',
      skillArea: '2W',
      skills: ['Brakes'],
      minExperienceMonths: 0,
      city: 'Bengaluru',
      openings: 1,
      description: 'Inspect and service two-wheeler braking systems at our Peenya workshop.',
      closingDate: '2026-12-31',
      vtaCertificatePreferred: false,
    });
    jobId = job.body.id;
    await c.employerAdminA!.post(`/employer/jobs/${jobId}/submit`);
    expect(await titles(c.secondAdmin!)).toContain('Job waiting for review: Brake specialist');
    expect(await titles(c.superAdmin!)).toContain('Job waiting for review: Brake specialist');
    expect(await titles(c.employerAdminA!)).not.toContain('Job waiting for review: Brake specialist');

    await c.secondAdmin!.post(`/admin/jobs/${jobId}/moderate`, { action: 'publish' });
    expect(await titles(c.employerAdminA!)).toContain('Brake specialist is live');
    expect(await titles(c.employerAdminB!)).not.toContain('Brake specialist is live');
    expect(await count(await userId(EMAIL.secondAdmin), 'job_published')).toBe(0);
  });

  it('an application reaches the employer; each move reaches the learner with a link to it', async () => {
    const applied = await c.ravi!.post(`/jobs/${jobId}/apply`, { shareProfile: true });
    appId = applied.body.id;
    const employerList = (await c.employerAdminA!.get('/notifications')).body;
    expect(employerList.items[0]).toMatchObject({ title: 'New application for Brake specialist', link: `/employer/applications/${appId}`, readAt: null });

    await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'shortlisted' });
    const mine = (await c.ravi!.get('/notifications')).body;
    expect(mine.items[0]).toMatchObject({ template: 'application_update', title: 'You’re shortlisted for Brake specialist'.replace('’', "'"), link: `/learn/applications/${appId}` });
    expect(mine.items[0].body).toContain('Sunrise Two-Wheeler Service (demo)');
  });

  it('scheduling an interview sends one interview notification, not one per automatic step', async () => {
    const ravi = (await ctx.db.selectFrom('users').select('id').where('phone', '=', RAVI).executeTakeFirstOrThrow()).id;
    const before = await count(ravi, 'application_update');
    const r = await c.employerAdminA!.post(`/employer/applications/${appId}/interviews`, { scheduledAt: '2026-11-05T10:30:00+05:30', mode: 'in_person', location: 'Peenya' });
    expect(r.status).toBe(201);
    expect(await count(ravi, 'application_update')).toBe(before);
    const n = (await c.ravi!.get('/notifications')).body.items[0];
    expect(n).toMatchObject({ template: 'interview_scheduled', title: 'Interview for Brake specialist' });
    expect(n.body).toContain('5 Nov 2026');
    expect(n.body).toContain('in person');
    // The employer's private notes are never part of it.
    expect(JSON.stringify(n)).not.toContain('Peenya');
  });

  it('a rejection is worded kindly and gives no internal reason', async () => {
    await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'rejected', reason: 'Not enough brake experience' });
    const n = (await c.ravi!.get('/notifications')).body.items[0];
    expect(n.title).toBe('Update on Brake specialist');
    expect(n.body).toContain('decided not to go ahead');
    expect(JSON.stringify(n)).not.toContain('brake experience');
  });

  it('unread count, mark one read, mark all read; only your own', async () => {
    const list = (await c.ravi!.get('/notifications')).body;
    expect(list.unread).toBeGreaterThanOrEqual(3);
    const first = list.items[0].id;
    expect((await c.employerAdminB!.post(`/notifications/${first}/read`)).status).toBe(404);
    const one = await c.ravi!.post(`/notifications/${first}/read`);
    expect(one.body.unread).toBe(list.unread - 1);
    expect((await c.ravi!.get('/notifications/unread-count')).body.unread).toBe(list.unread - 1);
    expect((await c.ravi!.get('/notifications?unread=1')).body.items.map((n: { id: string }) => n.id)).not.toContain(first);
    await c.ravi!.post('/notifications/read-all');
    expect((await c.ravi!.get('/notifications/unread-count')).body.unread).toBe(0);
  });

  it('verification decisions reach the organisation and the learner', async () => {
    await c.secondAdmin!.post(`/admin/organisations/${ctx.ids.employerPending}/request-info`, { reason: 'Upload a clearer GST certificate' });
    const pending = await loginEmail(ctx, EMAIL.employerAdminPending);
    const n = (await pending.get('/notifications')).body.items[0];
    expect(n).toMatchObject({ title: 'AutoTalent Grid needs more information', link: '/employer/company' });
    expect(n.body).toContain('clearer GST certificate');
  });

  it('a learner enrolled in a batch hears about it', async () => {
    const learner = (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id;
    const before = await count(learner, 'enrolled');
    const batch = await ctx.db.selectFrom('batches').select(['id']).where('status', '=', 'planned').executeTakeFirstOrThrow();
    const r = await c.secondAdmin!.post(`/admin/batches/${batch.id}/enrolments`, { candidateIds: [learner] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await count(learner, 'enrolled')).toBe(before + 1);
  });

  it('needs a sign-in', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/notifications' })).statusCode).toBe(401);
  });
});

describe('password reset and change', () => {
  const forgot = (email: string) => ctx.app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { email }, remoteAddress: nextIp() });
  const reset = (token: string, password: string) => ctx.app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token, password }, remoteAddress: nextIp() });
  const tokenFor = (email: string) => ctx.mem.sentResets.get(email)?.split('/reset-password/')[1];

  it('gives the same reply for unknown emails, phone-only learners and real accounts', async () => {
    for (const email of ['nobody@demo.vta.local', EMAIL.pending, EMAIL.partnerAdminB]) {
      const r = await forgot(email);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ok: true });
    }
    expect(tokenFor('nobody@demo.vta.local')).toBeUndefined();
    expect(tokenFor(EMAIL.partnerAdminB)).toBeDefined();
  });

  it('the link sets a new password once, signs out every session and clears a lock', async () => {
    const old = await loginEmail(ctx, EMAIL.partnerAdminB);
    const token = tokenFor(EMAIL.partnerAdminB)!;
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/password/reset/${token}` })).json()).toEqual({ email: EMAIL.partnerAdminB });
    expect((await reset(token, 'password123')).statusCode).toBe(400);
    expect((await reset(token, 'short')).json().error.fields.password).toBeDefined();
    expect((await reset(token, 'New-strong-pass-77')).statusCode).toBe(200);
    expect((await old.get('/auth/me')).status).toBe(401);
    expect((await loginEmail(ctx, EMAIL.partnerAdminB, 'New-strong-pass-77')).cookie).toBeTruthy();
    const again = await reset(token, 'Another-pass-88');
    expect(again.statusCode).toBe(404);
    expect(again.json().error.message).toMatch(/invalid, already used or expired/);
  });

  it('a newer link replaces the older one, links expire, and at most 3 emails an hour', async () => {
    ctx.mem.sentResets.clear();
    await forgot(EMAIL.employerAdminB);
    const first = tokenFor(EMAIL.employerAdminB)!;
    await forgot(EMAIL.employerAdminB);
    const second = tokenFor(EMAIL.employerAdminB)!;
    expect((await reset(first, 'Strong-pass-one-1')).statusCode).toBe(404);
    await ctx.db.updateTable('password_resets').set({ expires_at: new Date(Date.now() - 1000) }).where('used_at', 'is', null).execute();
    expect((await reset(second, 'Strong-pass-one-1')).statusCode).toBe(404);
    await forgot(EMAIL.employerAdminB); // third this hour
    const third = tokenFor(EMAIL.employerAdminB);
    ctx.mem.sentResets.clear();
    await forgot(EMAIL.employerAdminB); // fourth: same reply, no email
    expect(tokenFor(EMAIL.employerAdminB)).toBeUndefined();
    expect(third).toBeDefined();
  });

  it('changing the password checks the current one and signs out other devices only', async () => {
    const here = await loginEmail(ctx, EMAIL.partnerAdminA);
    const other = await loginEmail(ctx, EMAIL.partnerAdminA);
    const wrong = await here.post('/auth/password/change', { currentPassword: 'nope', newPassword: 'Changed-pass-123' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.fields.currentPassword).toBeDefined();
    const ok = await here.post('/auth/password/change', { currentPassword: ctx.passwordOf(EMAIL.partnerAdminA), newPassword: 'Changed-pass-123' });
    expect(ok.status).toBe(200);
    expect((await here.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
    // Phone sign-in accounts have no password to change.
    expect((await c.learner!.post('/auth/password/change', { currentPassword: 'x', newPassword: 'Changed-pass-123' })).status).toBe(400);
  });
});

describe('learner data download and account closure', () => {
  it('downloads everything kept about the learner as a JSON file, and logs it', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/me/export', headers: { cookie: c.ravi!.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="vta-talent-cloud-my-data-\d{4}-\d{2}-\d{2}\.json"/);
    const data = res.json();
    expect(data.account.mobile).toBe(RAVI);
    expect(data.consents.map((x: { purpose: string }) => x.purpose)).toEqual(expect.arrayContaining(['privacy_notice', 'terms']));
    expect(data.applications.some((a: { job: string }) => a.job === 'Brake specialist')).toBe(true);
    const ravi = (await ctx.db.selectFrom('users').select('id').where('phone', '=', RAVI).executeTakeFirstOrThrow()).id;
    const logged = await ctx.db.selectFrom('audit_events').select('id').where('action', '=', 'learner.data_exported').where('entity_id', '=', ravi).execute();
    expect(logged).toHaveLength(1);
    expect((await c.employerAdminA!.get('/me/export')).status).toBe(403);
  });

  it('a closure request takes the profile out of search at once and tells AutoTalent Grid; it can be cancelled', async () => {
    await ctx.db.updateTable('candidate_profiles').set({ searchable: true }).where('user_id', '=', (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id).execute();
    const r = await c.learner!.post('/me/closure-request', { reason: 'Moving abroad' });
    expect(r.status).toBe(201);
    expect((await c.learner!.post('/me/closure-request', {})).status).toBe(409);
    expect((await c.learner!.get('/me/closure-request')).body.request).toMatchObject({ reason: 'Moving abroad' });
    const learnerId = (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id;
    expect((await ctx.db.selectFrom('candidate_profiles').select('searchable').where('user_id', '=', learnerId).executeTakeFirstOrThrow()).searchable).toBe(false);
    expect(await titles(c.secondAdmin!)).toContain('A learner asked to close their account');
    expect((await c.learner!.post('/me/closure-request/cancel')).status).toBe(200);
    expect((await c.learner!.get('/me/closure-request')).body.request).toBeNull();
  });

  it('only an Admin completes it: deactivated, signed out, open applications withdrawn; records kept', async () => {
    await c.ravi!.post('/me/closure-request', {});
    const list = (await c.secondAdmin!.get('/admin/account-requests')).body.items;
    const req = list.find((x: { name: string }) => x.name)!;
    expect((await c.employerAdminA!.post(`/admin/account-requests/${req.id}/complete`, {})).status).toBe(403);
    expect((await c.superAdmin!.post(`/admin/account-requests/${req.id}/decline`, {})).body.error.fields.reason).toBeDefined();

    // Give Ravi an open application first.
    const other = await ctx.db.selectFrom('jobs').select('id').where('status', '=', 'published').where('title', '!=', 'Brake specialist').executeTakeFirstOrThrow();
    const app2 = await c.ravi!.post(`/jobs/${other.id}/apply`, { shareProfile: true });
    expect(app2.status).toBe(201);

    expect((await c.superAdmin!.post(`/admin/account-requests/${req.id}/complete`, { reason: 'Confirmed by phone' })).status).toBe(200);
    const ravi = await ctx.db.selectFrom('users').select(['id', 'status']).where('phone', '=', RAVI).executeTakeFirstOrThrow();
    expect(ravi.status).toBe('deactivated');
    expect((await c.ravi!.get('/auth/me')).status).toBe(401);
    const a = await ctx.db.selectFrom('job_applications').select('status').where('id', '=', app2.body.id).executeTakeFirstOrThrow();
    expect(a.status).toBe('withdrawn');
    const ev = await ctx.db.selectFrom('application_events').select(['from_status', 'actor_kind']).where('application_id', '=', app2.body.id).where('to_status', '=', 'withdrawn').executeTakeFirstOrThrow();
    expect(ev).toEqual({ from_status: 'applied', actor_kind: 'vta' });
    // Kept, not erased.
    expect(await ctx.db.selectFrom('candidate_profiles').select('user_id').where('user_id', '=', ravi.id).executeTakeFirst()).toBeDefined();
    expect((await c.superAdmin!.post(`/admin/account-requests/${req.id}/complete`, {})).status).toBe(400);
  });
});
