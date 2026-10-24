import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

describe('Phase 1 test 2: suspending a user signs them out on their next request', () => {
  it('suspend → 401 at once; reactivate → can sign in again', async () => {
    const victim = await loginEmail(ctx, EMAIL.recruiterA);
    expect((await victim.get('/auth/me')).status).toBe(200);

    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const id = ctx.ids.recruiterA!;
    expect((await ops.post(`/admin/users/${id}/suspend`, {})).status).toBe(400); // reason required
    expect((await ops.post(`/admin/users/${id}/suspend`, { reason: 'Left the company' })).status).toBe(200);

    expect((await victim.get('/auth/me')).status).toBe(401);
    await expect(loginEmail(ctx, EMAIL.recruiterA)).rejects.toThrow(/403/);

    expect((await ops.post(`/admin/users/${id}/reactivate`, {})).status).toBe(200);
    expect((await (await loginEmail(ctx, EMAIL.recruiterA)).get('/auth/me')).status).toBe(200);
  });

  it('a suspended phone user cannot sign in by OTP', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    await ops.post(`/admin/users/${ctx.ids.learner}/suspend`, { reason: 'Duplicate profile under review' });
    await expect(loginPhone(ctx, PHONE.learner)).rejects.toThrow();
    await ops.post(`/admin/users/${ctx.ids.learner}/reactivate`, {});
  });
});

describe('F-08 user lifecycle rules', () => {
  it('approves a pending user', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const res = await ops.post(`/admin/users/${ctx.ids.pendingUser}/approve`, {});
    expect(res.body.status).toBe('active');
    expect((await ops.post(`/admin/users/${ctx.ids.pendingUser}/approve`, {})).status).toBe(400);
  });

  it('nobody can change their own status', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    expect((await ops.post(`/admin/users/${ctx.ids.opsAdmin}/suspend`, { reason: 'Testing self' })).status).toBe(403);
  });

  it('an Ops Admin cannot suspend a Super Admin', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    expect((await ops.post(`/admin/users/${ctx.ids.superAdmin}/suspend`, { reason: 'Trying it' })).status).toBe(403);
  });

  it('only a Super Admin can deactivate', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    expect((await ops.post(`/admin/users/${ctx.ids.employerAdminB}/deactivate`, { reason: 'Closed account' })).status).toBe(403);
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const before = await loginEmail(ctx, EMAIL.employerAdminB);
    expect((await sa.post(`/admin/users/${ctx.ids.employerAdminB}/deactivate`, { reason: 'Closed account' })).status).toBe(200);
    expect((await before.get('/auth/me')).status).toBe(401);
    expect((await sa.post(`/admin/users/${ctx.ids.employerAdminB}/reactivate`, {})).status).toBe(400);
  });

  it('refuses a duplicate email or phone with field errors', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const res = await ops.post('/admin/users', { name: 'Copy', email: EMAIL.opsAdmin, phone: PHONE.learner });
    expect(res.status).toBe(409);
    expect(res.body.error.fields).toEqual({ email: 'Already in use', phone: 'Already in use' });
  });

  it('validates input with field-level messages', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const res = await ops.post('/admin/users', { name: 'X', phone: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['name', 'phone']));
  });

  it('lists users with server-side search, filters and pagination', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const page = await ops.get('/admin/users?pageSize=5&page=1');
    expect(page.body.items).toHaveLength(5);
    expect(page.body.total).toBeGreaterThan(5);
    expect((await ops.get('/admin/users?pageSize=500')).status).toBe(400);
    const partners = await ops.get('/admin/users?role=partner_admin');
    expect(partners.body.items.every((u: { roles: string[] }) => u.roles.includes('partner_admin'))).toBe(true);
    const search = await ops.get('/admin/users?q=Farah');
    expect(search.body.items.map((u: { name: string }) => u.name)).toEqual(['Farah Partner A']);
  });
});

describe('F-09 role assignment', () => {
  it('only a Super Admin can grant roles', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    expect((await ops.post('/admin/role-assignments', { userId: ctx.ids.learner, role: 'ops_admin' })).status).toBe(403);
  });

  it('checks the scope each role needs', async () => {
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const noOrg = await sa.post('/admin/role-assignments', { userId: ctx.ids.learner, role: 'employer_recruiter' });
    expect(noOrg.body.error.fields.organisationId).toBeDefined();
    const wrongType = await sa.post('/admin/role-assignments', { userId: ctx.ids.learner, role: 'employer_recruiter', organisationId: ctx.ids.partnerA });
    expect(wrongType.status).toBe(400);
    const foreignCentre = await sa.post('/admin/role-assignments', {
      userId: ctx.ids.learner, role: 'trainer', organisationId: ctx.ids.partnerA, centreId: ctx.ids.centrePartnerB,
    });
    expect(foreignCentre.body.error.fields.centreId).toMatch(/not run by this partner/);
    const platformWithOrg = await sa.post('/admin/role-assignments', { userId: ctx.ids.learner, role: 'ops_admin', organisationId: ctx.ids.employerA });
    expect(platformWithOrg.status).toBe(400);
  });

  it('a revoked role stops working on the next request', async () => {
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const grant = await sa.post('/admin/role-assignments', { userId: ctx.ids.centreAdmin, role: 'ops_admin' });
    expect(grant.status).toBe(201);
    expect((await sa.post('/admin/role-assignments', { userId: ctx.ids.centreAdmin, role: 'ops_admin' })).status).toBe(409);

    const user = await loginEmail(ctx, EMAIL.centreAdmin);
    expect((await user.get('/admin/users')).status).toBe(200);
    expect((await sa.post(`/admin/role-assignments/${grant.body.id}/revoke`, {})).status).toBe(200);
    expect((await user.get('/admin/users')).status).toBe(403);
  });

  it('refuses to revoke the last active Super Admin', async () => {
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const detail = await sa.get(`/admin/users/${ctx.ids.superAdmin}`);
    const ra = detail.body.roleAssignments.find((r: { role: string }) => r.role === 'super_admin');
    const res = await sa.post(`/admin/role-assignments/${ra.id}/revoke`, {});
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/last active Super Admin/);
  });
});

describe('F-10 organisations and F-11 centres', () => {
  it('verifies, rejects and requests information with reasons', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const created = await ops.post('/admin/organisations', { type: 'partner', partnerSubtype: 'college', legalName: 'Demo Polytechnic' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await ops.post(`/admin/organisations/${id}/reject`, {})).status).toBe(400);
    expect((await ops.post(`/admin/organisations/${id}/request-info`, { reason: 'Upload registration certificate' })).body.verificationStatus).toBe('more_info_needed');
    expect((await ops.post(`/admin/organisations/${id}/verify`, {})).body.verificationStatus).toBe('verified');
    const list = await ops.get('/admin/organisations?type=partner&verificationStatus=verified&q=Polytechnic');
    expect(list.body.items[0].verifiedAt).toBeTruthy();
  });

  it('a partner organisation needs a partner type', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const res = await ops.post('/admin/organisations', { type: 'partner', legalName: 'No Type Partner' });
    expect(res.body.error.fields.partnerSubtype).toBeDefined();
  });

  it('creates, edits, deactivates and searches centres', async () => {
    const ops = await loginEmail(ctx, EMAIL.opsAdmin);
    const c = await ops.post('/admin/centres', { name: 'Hubballi Centre', city: 'Hubballi', organisationId: ctx.ids.partnerA });
    expect(c.status).toBe(201);
    expect((await ops.post('/admin/centres', { name: 'Bad Owner', organisationId: ctx.ids.employerA })).status).toBe(400);
    expect((await ops.patch(`/admin/centres/${c.body.id}`, { city: 'Dharwad' })).status).toBe(200);
    expect((await ops.post(`/admin/centres/${c.body.id}/deactivate`, {})).body.status).toBe('inactive');
    const found = await ops.get('/centres?q=Dharwad&status=inactive');
    expect(found.body.items.map((x: { name: string }) => x.name)).toEqual(['Hubballi Centre']);
  });
});
