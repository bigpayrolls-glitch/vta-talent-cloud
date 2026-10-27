import { NOTICE_VERSION } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFromCookie, cookieFrom, EMAIL, loginEmail, nextIp, setup, type Ctx } from './helpers.js';

/** Phase 8: employers and training partners register their own organisation (EM-01, PA-01). */
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const URL = '/api/v1/public/organisations/register';
const base = {
  type: 'employer',
  legalName: 'Kaveri Auto Works',
  sector: 'service_workshop',
  city: 'Mandya',
  contactName: 'Asha Rao',
  email: 'asha@kaveri.example',
  phone: '98450 12345',
  acceptPrivacy: true,
  acceptTerms: true,
  noticeVersion: NOTICE_VERSION,
};
const register = (body: object, ip = nextIp()) => ctx.app.inject({ method: 'POST', url: URL, payload: body, remoteAddress: ip });
const tokenFor = (email: string) => ctx.mem.sentInvites.get(email)?.split('/invite/')[1];
const accept = (token: string) => ctx.app.inject({ method: 'POST', url: `/api/v1/auth/invitations/${token}/accept`, payload: { password: 'A-strong-pass-42' }, remoteAddress: nextIp() });
const orgByName = (name: string) => ctx.db.selectFrom('organisations').selectAll().where('legal_name', '=', name).execute();

describe('organisation self-registration', () => {
  it('creates a pending organisation and an inactive admin, and emails a confirmation link', async () => {
    const res = await register(base);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true }); // no link in the reply outside staging

    const [org] = await orgByName('Kaveri Auto Works');
    expect(org).toMatchObject({ type: 'employer', sector: 'service_workshop', city: 'Mandya', verification_status: 'pending', registration_source: 'self', submitted_at: null, contact_phone: '+919845012345' });
    const user = await ctx.db.selectFrom('users').selectAll().where('email', '=', 'asha@kaveri.example').executeTakeFirstOrThrow();
    expect(user.status).toBe('invited');
    expect(user.password_hash).toBeNull();
    const consents = await ctx.db.selectFrom('consent_events').select(['purpose', 'notice_version', 'source']).where('user_id', '=', user.id).execute();
    expect(consents.map((c) => c.purpose).sort()).toEqual(['privacy_notice', 'terms']);
    expect(consents.every((c) => c.notice_version === NOTICE_VERSION && c.source === 'self')).toBe(true);
    const events = await ctx.db.selectFrom('audit_events').select('action').where('entity_id', '=', org!.id).execute();
    expect(events.map((e) => e.action)).toContain('organisation.self_registered');
  });

  it('AutoTalent Grid sees it flagged as self-registered and awaiting email confirmation; the person cannot sign in yet', async () => {
    const admin = await loginEmail(ctx, EMAIL.secondAdmin);
    const list = await admin.get('/admin/organisations?q=Kaveri');
    expect(list.body.items[0]).toMatchObject({ legalName: 'Kaveri Auto Works', registrationSource: 'self', awaitingEmail: true, submittedAt: null });
    const login = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'asha@kaveri.example', password: 'A-strong-pass-42' }, remoteAddress: nextIp() });
    expect(login.statusCode).toBe(401);
  });

  it('the link confirms the email, sets a password and opens the employer portal on the company profile', async () => {
    const token = tokenFor('asha@kaveri.example')!;
    const info = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` });
    expect(info.json()).toMatchObject({ name: 'Asha Rao', selfRegistered: true, organisationName: 'Kaveri Auto Works' });

    const ok = await accept(token);
    expect(ok.statusCode).toBe(200);
    const c = await clientFromCookie(ctx.app, cookieFrom(ok));
    const me = (await c.get('/auth/me')).body;
    expect(me.portals).toEqual(['employer']);
    const company = await c.get('/employer/company');
    expect(company.body).toMatchObject({ legalName: 'Kaveri Auto Works', verificationStatus: 'pending', submittedAt: null });
    // Sending it to VTA still needs a registration document, as for organisations VTA added.
    const submit = await c.post('/employer/company/submit');
    expect(submit.status).toBe(400);
    expect(submit.body.error.fields.documents).toBeDefined();

    const admin = await loginEmail(ctx, EMAIL.secondAdmin);
    expect((await admin.get('/admin/organisations?q=Kaveri')).body.items[0].awaitingEmail).toBe(false);
  });

  it('invitation links from AutoTalent Grid are still described as invitations', async () => {
    const admin = await loginEmail(ctx, EMAIL.superAdmin);
    await admin.post('/admin/users', { name: 'Invited Person', email: 'invited-p8@demo.vta.local' });
    const info = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${tokenFor('invited-p8@demo.vta.local')}` });
    expect(info.json()).toMatchObject({ selfRegistered: false, organisationName: null });
  });

  it('an email that already has an account gets the same reply, and nothing is created or sent', async () => {
    ctx.mem.sentInvites.clear();
    const before = await ctx.db.selectFrom('organisations').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    for (const email of [EMAIL.employerAdminA, 'asha@kaveri.example']) {
      const res = await register({ ...base, legalName: 'Another Garage', email });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: true });
    }
    const after = await ctx.db.selectFrom('organisations').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
    expect(ctx.mem.sentInvites.size).toBe(0);
  });

  it('registering again before confirming sends a fresh link (the old one stops working) and adds no second organisation', async () => {
    const p = { ...base, type: 'partner', partnerSubtype: 'ngo', sector: undefined, legalName: 'Udaan Skills Foundation', email: 'ravi@udaan.example', contactName: 'Ravi Kumar' };
    await register(p);
    const first = tokenFor('ravi@udaan.example')!;
    await register(p);
    const second = tokenFor('ravi@udaan.example')!;
    expect(second).not.toBe(first);
    expect(await orgByName('Udaan Skills Foundation')).toHaveLength(1);
    expect((await accept(first)).statusCode).toBe(404);
    const ok = await accept(second);
    expect(ok.statusCode).toBe(200);
    const c = await clientFromCookie(ctx.app, cookieFrom(ok));
    expect((await c.get('/auth/me')).body.portals).toEqual(['partner']);
    expect((await c.get('/partner/organisation')).body).toMatchObject({ legalName: 'Udaan Skills Foundation', partnerSubtype: 'ngo', verificationStatus: 'pending' });
    // Nothing assigned yet: a new partner sees no programmes until VTA links them (PA-02).
    expect((await c.get('/programmes')).body.items).toEqual([]);
  });

  it('a name matching an existing organisation is flagged for AutoTalent Grid, not refused', async () => {
    const res = await register({ ...base, legalName: '  sunrise two-wheeler   SERVICE (demo) ', email: 'copy@sunrise.example' });
    expect(res.statusCode).toBe(202);
    const org = await ctx.db.selectFrom('organisations').selectAll().where('contact_email', '=', 'copy@sunrise.example').executeTakeFirstOrThrow();
    expect(org.duplicate_of).toBe(ctx.ids.employerA);
    const admin = await loginEmail(ctx, EMAIL.secondAdmin);
    const row = (await admin.get('/admin/organisations?type=employer&pageSize=100')).body.items.find((o: { id: string }) => o.id === org.id);
    expect(row.possibleDuplicate).toBe(true);
  });

  it('checks the form: partner type, sector, agreements and the current notice version', async () => {
    const bad = await register({ ...base, type: 'partner', sector: undefined, acceptTerms: false, email: 'x@y.example' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fields)).toEqual(expect.arrayContaining(['partnerSubtype', 'acceptTerms']));
    expect((await register({ ...base, sector: undefined, email: 'x@y.example' })).json().error.fields.sector).toBeDefined();
    expect((await register({ ...base, noticeVersion: 'old', email: 'x@y.example' })).statusCode).toBe(400);
    expect((await register({ ...base, phone: '12345', email: 'x@y.example' })).json().error.fields.phone).toBeDefined();
    expect(await ctx.db.selectFrom('users').select('id').where('email', '=', 'x@y.example').executeTakeFirst()).toBeUndefined();
  });

  it('a filled-in hidden field (a bot) gets the normal reply but nothing is stored', async () => {
    const res = await register({ ...base, legalName: 'Bot Garage', email: 'bot@spam.example', nickname: 'buy now' });
    expect(res.statusCode).toBe(202);
    expect(await orgByName('Bot Garage')).toHaveLength(0);
    expect(tokenFor('bot@spam.example')).toBeUndefined();
  });

  it('is rate-limited per address', async () => {
    const ip = '10.99.0.1';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await register({ ...base, email: `rl${i}@x.example`, nickname: 'x' }, ip)).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 202)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('a self-registered employer cannot publish jobs or search candidates until AutoTalent Grid verifies it', async () => {
    const token = tokenFor('copy@sunrise.example')!;
    const c = await clientFromCookie(ctx.app, cookieFrom(await accept(token)));
    expect((await c.get('/employer/candidates')).status).toBeGreaterThanOrEqual(400);
  });
});
