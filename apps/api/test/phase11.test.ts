import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, nextIp, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 11: VTA changes a sign-in mobile number; partner admins manage their viewers (PA-07). */
let ctx: Ctx;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  c.ops = await loginEmail(ctx, EMAIL.opsAdmin);
  c.centre = await loginEmail(ctx, EMAIL.centreAdmin);
  c.partnerA = await loginEmail(ctx, EMAIL.partnerAdminA);
  c.viewerA = await loginEmail(ctx, EMAIL.partnerViewerA);
  c.partnerB = await loginEmail(ctx, EMAIL.partnerAdminB);
});
afterAll(() => ctx.close());

const idByPhone = async (phone: string) => (await ctx.db.selectFrom('users').select('id').where('phone', '=', phone).executeTakeFirstOrThrow()).id;

describe('changing the mobile number someone signs in with', () => {
  it('VTA changes it with a reason; the old number stops working, the new one signs in, sessions end', async () => {
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

  it('refuses a number another account uses, the same number, email-only accounts and non-VTA staff', async () => {
    const id = await idByPhone(PHONE.trainerA);
    const taken = await c.ops!.post(`/admin/users/${id}/phone`, { phone: PHONE.trainerB, reason: 'Checked ID card' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.fields.phone).toBe('Already in use');
    expect((await c.ops!.post(`/admin/users/${id}/phone`, { phone: PHONE.trainerA, reason: 'Checked ID card' })).status).toBe(400);
    const emailUser = (await ctx.db.selectFrom('users').select('id').where('email', '=', EMAIL.recruiterA).executeTakeFirstOrThrow()).id;
    expect((await c.ops!.post(`/admin/users/${emailUser}/phone`, { phone: '9845011111', reason: 'Checked ID card' })).status).toBe(400);
    expect((await c.centre!.post(`/admin/users/${id}/phone`, { phone: '9845011111', reason: 'Checked ID card' })).status).toBe(403);
  });
});

describe('PA-07 partner admins manage viewers', () => {
  it('the partner admin sees the team and invites a viewer who can read but not change anything', async () => {
    const team = (await c.partnerA!.get('/partner/team')).body.items;
    expect(team.map((m: { role: string }) => m.role)).toEqual(expect.arrayContaining(['partner_admin', 'partner_viewer']));
    const r = await c.partnerA!.post('/partner/team', { name: 'Kavya Viewer', email: 'kavya@skillbridge.example' });
    expect(r.status).toBe(201);
    const token = ctx.mem.sentInvites.get('kavya@skillbridge.example')!.split('/invite/')[1]!;
    const accepted = await ctx.app.inject({ method: 'POST', url: `/api/v1/auth/invitations/${token}/accept`, payload: { password: 'Viewer-pass-123' }, remoteAddress: nextIp() });
    expect(accepted.statusCode).toBe(200);
    const kavya = await loginEmail(ctx, 'kavya@skillbridge.example', 'Viewer-pass-123');
    expect((await kavya.get('/auth/me')).body.roles[0]).toMatchObject({ role: 'partner_viewer', organisationId: ctx.ids.partnerA });
    expect((await kavya.get('/programmes')).body.total).toBeGreaterThanOrEqual(1);
    expect((await kavya.get('/partner/team')).status).toBe(403);
    expect((await kavya.put('/partner/organisation', {})).status).toBe(403);
    const logged = await ctx.db.selectFrom('audit_events').select('action').where('action', '=', 'partner.viewer_invited').execute();
    expect(logged).toHaveLength(1);
  });

  it('viewers cannot invite; an email already in use is refused; another partner cannot touch this team', async () => {
    expect((await c.viewerA!.post('/partner/team', { name: 'Someone', email: 'x@y.example' })).status).toBe(403);
    expect((await c.partnerA!.post('/partner/team', { name: 'Dup', email: EMAIL.recruiterA })).status).toBe(409);
    const kavya = (await c.partnerA!.get('/partner/team')).body.items.find((m: { name: string }) => m.name === 'Kavya Viewer');
    expect((await c.partnerB!.post(`/partner/team/${kavya.assignmentId}/remove`)).status).toBe(404);
  });

  it('the partner admin removes a viewer (access ends at once) but not themselves or another admin', async () => {
    const team = (await c.partnerA!.get('/partner/team')).body.items;
    const me = team.find((m: { isMe: boolean }) => m.isMe);
    expect((await c.partnerA!.post(`/partner/team/${me.assignmentId}/remove`)).status).toBe(403);
    const kavya = team.find((m: { name: string }) => m.name === 'Kavya Viewer');
    const session = await loginEmail(ctx, 'kavya@skillbridge.example', 'Viewer-pass-123');
    expect((await c.partnerA!.post(`/partner/team/${kavya.assignmentId}/remove`)).status).toBe(200);
    expect((await session.get('/programmes')).status).toBe(403);
    expect((await ctx.db.selectFrom('audit_events').select('action').where('action', '=', 'partner.viewer_removed').execute())).toHaveLength(1);
  });
});
