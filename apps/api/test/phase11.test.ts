import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, nextIp, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 11: VTA changes a sign-in mobile number. PA-07 (partner viewers) was retired by the five-logins decision of 27 Oct 2026. */
let ctx: Ctx;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  c.ops = await loginEmail(ctx, EMAIL.secondAdmin);
  c.partnerA = await loginEmail(ctx, EMAIL.partnerAdminA);
  c.partnerB = await loginEmail(ctx, EMAIL.partnerAdminB);
});
afterAll(() => ctx.close());

const idByPhone = async (phone: string) => (await ctx.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirstOrThrow()).id;

describe('changing the mobile number someone signs in with', () => {
  it('AutoTalent Grid changes it with a reason; the old number stops working, the new one signs in, sessions end', async () => {
    const id = await idByPhone(PHONE.learner);
    const before = await loginPhone(ctx, PHONE.learner);
    expect((await c.ops!.post(`/admin/users/${id}/phone`, { phone: '9845098450' })).body.error.fields.reason).toBeDefined();
    const ok = await c.ops!.post(`/admin/users/${id}/phone`, { phone: '98450 98450', reason: 'Checked Aadhaar at the Peenya centre' });
    expect(ok.body).toEqual({ id, phone: '+919845098450' });

    expect((await before.get('/auth/me')).status).toBe(401);
    ctx.mem.sentOtps.delete(PHONE.learner);
    const old = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: PHONE.learner }, remoteAddress: nextIp() });
    expect(old.statusCode).toBe(200); // the same reply as for any number…
    expect(ctx.mem.sentOtps.get(PHONE.learner)).toBeUndefined(); // …but no code goes to the old number any more

    const fresh = await loginPhone(ctx, '+919845098450');
    const me = (await fresh.get('/auth/me')).body;
    expect(me.id).toBe(id);
    const n = (await fresh.get('/notifications')).body.items[0];
    expect(n.title).toBe('Your mobile number was changed');
    expect(n.body).toContain('+9198*****50');

    const a = await ctx.db.selectFrom('audit_events').select(['before', 'after']).where('action', '=', 'user.phone_changed').where('entity_id', '=', id).executeTakeFirstOrThrow();
    expect(JSON.stringify(a)).toContain('Checked Aadhaar');
    expect(JSON.stringify(a)).not.toContain('9845098450'); // numbers are masked in the audit trail
  });

  it('refuses a number another account uses, the same number, email-only accounts and non-AutoTalent Grid staff', async () => {
    const id = await idByPhone(PHONE.trainerA);
    const taken = await c.ops!.post(`/admin/users/${id}/phone`, { phone: PHONE.trainerB, reason: 'Checked ID card' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.fields.phone).toBe('Already in use');
    expect((await c.ops!.post(`/admin/users/${id}/phone`, { phone: PHONE.trainerA, reason: 'Checked ID card' })).status).toBe(400);
    const emailUser = (await ctx.db.selectFrom('users').select('id').where('email', '=', EMAIL.employerAdminA).executeTakeFirstOrThrow()).id;
    expect((await c.ops!.post(`/admin/users/${emailUser}/phone`, { phone: '9845011111', reason: 'Checked ID card' })).status).toBe(400);
    // Not even the training partner this trainer works for.
    expect((await c.partnerA!.post(`/admin/users/${id}/phone`, { phone: '9845011111', reason: 'Checked ID card' })).status).toBe(403);
  });
});

describe('one login per training partner', () => {
  it('the partner team pages are gone and a second training partner login is refused', async () => {
    expect((await c.partnerA!.get('/partner/team')).status).toBe(404);
    expect((await c.partnerA!.post('/partner/team', { name: 'Kavya Viewer', email: 'kavya@skillbridge.example' })).status).toBe(404);
    expect(ctx.mem.sentInvites.has('kavya@skillbridge.example')).toBe(false);
    const second = await c.ops!.post('/admin/role-assignments', { userId: ctx.ids.pendingUser, role: 'partner_admin', organisationId: ctx.ids.partnerA });
    expect(second.status).toBe(400);
    expect(second.body.error.message).toMatch(/This organisation already has its login/);
    // Training partners cannot hand out logins themselves.
    expect((await c.partnerB!.post('/admin/role-assignments', { userId: ctx.ids.pendingUser, role: 'partner_admin', organisationId: ctx.ids.partnerA })).status).toBe(403);
  });
});
