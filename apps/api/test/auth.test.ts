import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/lib/crypto.js';
import { clientFromCookie, cookieFrom, EMAIL, loginEmail, loginPhone, nextIp, PHONE, setup, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const post = (url: string, payload: object, ip = nextIp()) =>
  ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, payload, remoteAddress: ip });

describe('Phase 1 test 1: each role signs in and reaches only its own portal', () => {
  it.each([
    [EMAIL.superAdmin, ['admin']],
    [EMAIL.opsAdmin, ['admin']],
    [EMAIL.centreAdmin, ['admin']],
    [EMAIL.employerAdminA, ['employer']],
    [EMAIL.recruiterA, ['employer']],
    [EMAIL.partnerAdminA, ['partner']],
    [EMAIL.partnerViewerA, ['partner']],
    [EMAIL.multi, ['admin', 'partner']],
  ])('%s → %j', async (email, portals) => {
    const c = await loginEmail(ctx, email);
    const me = await c.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.portals).toEqual(portals);
  });

  it('trainer signs in by phone OTP and lands in the Training Partner portal', async () => {
    const c = await loginPhone(ctx, PHONE.trainerA);
    expect((await c.get('/auth/me')).body.portals).toEqual(['partner']);
  });

  it('learner signs in by phone OTP and lands in the Learner portal', async () => {
    const c = await loginPhone(ctx, PHONE.learner);
    expect((await c.get('/auth/me')).body.portals).toEqual(['learn']);
  });

  it('non-admin roles are refused on Admin Portal routes', async () => {
    for (const email of [EMAIL.employerAdminA, EMAIL.partnerAdminA, EMAIL.partnerViewerA]) {
      const c = await loginEmail(ctx, email);
      expect((await c.get('/admin/users')).status).toBe(403);
      expect((await c.get('/admin/dashboard')).status).toBe(403);
    }
    const learner = await loginPhone(ctx, PHONE.learner);
    expect((await learner.get('/admin/users')).status).toBe(403);
  });
});

describe('F-03 email + password sign-in', () => {
  it('gives the same generic error for an unknown email and a wrong password', async () => {
    const a = await post('/auth/login', { email: 'nobody@demo.vta.local', password: 'whatever-123' });
    const b = await post('/auth/login', { email: EMAIL.opsAdmin, password: 'wrong-password-1' });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it('locks the account for 15 minutes after 5 failures, even for the right password', async () => {
    for (let i = 0; i < 5; i++) await post('/auth/login', { email: EMAIL.partnerAdminB, password: `wrong-password-${i}` });
    const res = await post('/auth/login', { email: EMAIL.partnerAdminB, password: ctx.passwordOf(EMAIL.partnerAdminB) });
    expect(res.statusCode).toBe(429);
    const user = await ctx.db.selectFrom('users').select('locked_until').where('email', '=', EMAIL.partnerAdminB).executeTakeFirstOrThrow();
    expect(user.locked_until!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    // Unlock for later tests
    await ctx.db.updateTable('users').set({ locked_until: null, failed_login_count: 0 }).where('email', '=', EMAIL.partnerAdminB).execute();
  });

  it('refuses a user who is pending approval', async () => {
    await ctx.db.updateTable('users').set({ password_hash: await hashPassword('Pending-user-pass-1') }).where('email', '=', EMAIL.pending).execute();
    const res = await post('/auth/login', { email: EMAIL.pending, password: 'Pending-user-pass-1' });
    expect(res.statusCode).toBe(401);
  });

  it('rate-limits sign-in attempts from one IP (20 a minute)', async () => {
    const ip = '10.99.0.1';
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await post('/auth/login', { email: `nobody${i}@demo.vta.local`, password: 'x-password-1' }, ip)).statusCode;
    expect(last).toBe(429);
  });

  it('sign-out ends the session on the server', async () => {
    const c = await loginEmail(ctx, EMAIL.opsAdmin);
    expect((await c.post('/auth/logout')).status).toBe(200);
    expect((await c.get('/auth/me')).status).toBe(401);
  });

  it('session cookie is httpOnly and SameSite=Lax', async () => {
    const res = await post('/auth/login', { email: EMAIL.opsAdmin, password: ctx.passwordOf(EMAIL.opsAdmin) });
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
  });
});

describe('CSRF protection', () => {
  it('refuses a state-changing request without the CSRF header', async () => {
    const c = await loginEmail(ctx, EMAIL.opsAdmin);
    const res = await c.post('/auth/logout', {}, { csrf: null });
    expect(res.status).toBe(403);
    const wrong = await c.post('/auth/logout', {}, { csrf: 'not-the-token' });
    expect(wrong.status).toBe(403);
  });
});

describe('Phase 1 test 5: phone OTP expiry, attempts and resend gap', () => {
  const phone = PHONE.learner;
  const reset = () => ctx.db.deleteFrom('otp_challenges').where('phone', '=', phone).execute();

  it('enforces a 60-second gap between codes', async () => {
    await reset();
    expect((await post('/auth/otp/request', { phone })).statusCode).toBe(200);
    const again = await post('/auth/otp/request', { phone });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.message).toMatch(/wait \d+ seconds/);
  });

  it('rejects a code after 5 minutes', async () => {
    await reset();
    await post('/auth/otp/request', { phone });
    const code = ctx.mem.sentOtps.get(phone)!;
    await ctx.db.updateTable('otp_challenges').set({ expires_at: new Date(Date.now() - 1000) }).where('phone', '=', phone).execute();
    const res = await post('/auth/otp/verify', { phone, code });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/expired/);
  });

  it('allows 5 attempts, then the right code no longer works', async () => {
    await reset();
    await post('/auth/otp/request', { phone });
    const code = ctx.mem.sentOtps.get(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      const r = await post('/auth/otp/verify', { phone, code: wrong });
      expect(r.json().error.message).toContain(`${5 - i} attempt`);
    }
    expect((await post('/auth/otp/verify', { phone, code: wrong })).json().error.message).toMatch(/expired/);
    expect((await post('/auth/otp/verify', { phone, code })).statusCode).toBe(400);
  });

  it('a code works only once', async () => {
    await reset();
    await post('/auth/otp/request', { phone });
    const code = ctx.mem.sentOtps.get(phone)!;
    expect((await post('/auth/otp/verify', { phone, code })).statusCode).toBe(200);
    expect((await post('/auth/otp/verify', { phone, code })).statusCode).toBe(400);
  });

  it('gives the same answer for an unregistered number and sends no SMS', async () => {
    const unknown = '+919811112222';
    const res = await post('/auth/otp/request', { phone: unknown });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/If this number is registered/);
    expect(ctx.mem.sentOtps.has(unknown)).toBe(false);
  });

  it('caps codes at 5 an hour per number', async () => {
    await reset();
    const old = Date.now() - 10 * 60_000;
    for (let i = 0; i < 5; i++) {
      await ctx.db
        .insertInto('otp_challenges')
        .values({ id: crypto.randomUUID(), phone, code_hash: 'x', purpose: 'login', expires_at: new Date(old), created_at: new Date(old - i * 1000) })
        .execute();
    }
    expect((await post('/auth/otp/request', { phone })).json().error.message).toMatch(/an hour/);
  });

  it('accepts 10-digit numbers and normalises them to +91', async () => {
    await reset();
    expect((await post('/auth/otp/request', { phone: '99000 00201' })).statusCode).toBe(200);
    expect(ctx.mem.sentOtps.get('+919900000201')).toBeDefined();
  });
});

describe('Invitations', () => {
  it('invites by email, accepts with a password, and signs the user in', async () => {
    const admin = await loginEmail(ctx, EMAIL.superAdmin);
    const res = await admin.post('/admin/users', {
      name: 'New Recruiter',
      email: 'new-recruiter@demo.vta.local',
      role: { role: 'employer_recruiter', organisationId: ctx.ids.employerA },
    });
    expect(res.status).toBe(201);
    const link = ctx.mem.sentInvites.get('new-recruiter@demo.vta.local')!;
    const token = link.split('/invite/')[1]!;

    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` })).json().name).toBe('New Recruiter');

    const common = await post(`/auth/invitations/${token}/accept`, { password: 'password123' });
    expect(common.statusCode).toBe(400);
    const short = await post(`/auth/invitations/${token}/accept`, { password: 'short' });
    expect(short.json().error.fields.password).toBeDefined();

    const ok = await post(`/auth/invitations/${token}/accept`, { password: 'A-strong-pass-42' });
    expect(ok.statusCode).toBe(200);
    const c = await clientFromCookie(ctx.app, cookieFrom(ok));
    expect((await c.get('/auth/me')).body.portals).toEqual(['employer']);

    // The link works once only
    expect((await post(`/auth/invitations/${token}/accept`, { password: 'A-strong-pass-43' })).statusCode).toBe(404);
  });

  it('expired invitation links are refused', async () => {
    const admin = await loginEmail(ctx, EMAIL.opsAdmin);
    await admin.post('/admin/users', { name: 'Late Person', email: 'late@demo.vta.local' });
    const token = ctx.mem.sentInvites.get('late@demo.vta.local')!.split('/invite/')[1]!;
    await ctx.db.updateTable('invitations').set({ expires_at: new Date(Date.now() - 1000) }).execute();
    expect((await post(`/auth/invitations/${token}/accept`, { password: 'A-strong-pass-42' })).statusCode).toBe(404);
  });

  it('an Ops Admin cannot attach a role while inviting (only Super Admin assigns roles)', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const res = await ops.post('/admin/users', { name: 'Sneaky Admin', email: 'sneaky@demo.vta.local', role: { role: 'super_admin' } });
    expect(res.status).toBe(403);
    expect(await ctx.db.selectFrom('users').select('id').where('email', '=', 'sneaky@demo.vta.local').executeTakeFirst()).toBeUndefined();
  });

  it('a phone-invited trainer activates on first OTP sign-in', async () => {
    const admin = await loginEmail(ctx, EMAIL.superAdmin);
    const res = await admin.post('/admin/users', {
      name: 'Field Trainer',
      phone: '9900000301',
      role: { role: 'trainer', organisationId: ctx.ids.partnerA, centreId: ctx.ids.centrePartnerA },
    });
    expect(res.status).toBe(201);
    expect(res.body.signInMethod).toBe('phone_otp');
    const c = await loginPhone(ctx, '+919900000301');
    const me = (await c.get('/auth/me')).body;
    expect(me.status).toBe('active');
    expect(me.portals).toEqual(['partner']);
  });
});
