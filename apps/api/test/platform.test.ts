import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@vta/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { EMAIL, loginEmail, setup, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

describe('Phase 1 test 4: every API route declares a permission', () => {
  it('all registered routes are either public or name a known permission', () => {
    for (const r of ctx.app.routeTable) {
      if (r.public) continue;
      expect(Object.keys(PERMISSIONS), `${r.method} ${r.url}`).toContain(r.permission);
    }
    const publicRoutes = ctx.app.routeTable.filter((r) => r.public).map((r) => `${r.method} ${r.url}`).sort();
    // The full list of routes anyone can call without signing in. Adding one must be deliberate.
    expect(publicRoutes).toEqual([
      'GET /api/v1/auth/invitations/:token',
      'GET /api/v1/files/:id/content', // signed, 5-minute links only (T-06)
      'GET /api/v1/health/live',
      'GET /api/v1/health/ready',
      'POST /api/v1/auth/invitations/:token/accept',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/otp/request',
      'POST /api/v1/auth/otp/verify',
      'POST /api/v1/auth/register', // self-registration, needs a phone code (EE-01)
      'POST /api/v1/auth/register/trainer', // independent trainers sign up; an Admin verifies them (27 Oct 2026)
      'GET /api/v1/public/credentials/:code', // QR verification page, approved fields only (AD-07)
      'GET /api/v1/auth/password/reset/:token', // checks a reset link before the form is shown
      'POST /api/v1/auth/password/forgot', // same reply for any email; 3 emails an hour per account
      'POST /api/v1/auth/password/reset', // single-use, 30-minute link
      'GET /api/v1/public/courses', // course catalogue: courses, open batches, centres; no people (Phase 13)
      'GET /api/v1/public/courses/:id',
      'POST /api/v1/payments/razorpay/webhook', // Razorpay's server: accepted only with a valid signature (HMAC of the raw body)
      'POST /api/v1/public/organisations/register', // employer/partner sign-up: pending until email confirmed and AutoTalent Grid verifies (EM-01, PA-01)
    ].sort());
  });

  it('the app refuses to start if a route forgets its permission', async () => {
    const app = await buildApp({ db: ctx.db, config: loadConfig({ NODE_ENV: 'test' }), logger: false });
    await expect(
      app.register(async (a) => {
        a.get('/forgot-permission', async () => 'oops');
      }).then(() => app.ready()),
    ).rejects.toThrow(/must declare config.permission/);
  });
});

describe('Phase 1 test 6: audit log', () => {
  it('sensitive actions write actor, action, target, request ID and before/after', async () => {
    const ops = await loginEmail(ctx, EMAIL.secondAdmin);
    await ops.post(`/admin/users/${ctx.ids.employerAdminPending}/suspend`, { reason: 'Audit test' });
    const row = await ctx.db
      .selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'user.suspended')
      .where('entity_id', '=', ctx.ids.employerAdminPending!)
      .executeTakeFirstOrThrow();
    expect(row.actor_id).toBe(ctx.ids.opsAdmin);
    expect(row.request_id).toBeTruthy();
    expect(row.before).toEqual({ status: 'active' });
    expect(row.after).toEqual({ status: 'suspended', reason: 'Audit test' });
  });

  it('never stores password or token hashes', async () => {
    const all = await ctx.db.selectFrom('audit_events').select(['before', 'after']).execute();
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/password_hash|token_hash|code_hash|csrf_token/);
  });

  it('rows cannot be updated or deleted, even by the table owner', async () => {
    await expect(sql`update audit_events set action = 'tampered'`.execute(ctx.db)).rejects.toThrow(/append-only/);
    await expect(sql`delete from audit_events`.execute(ctx.db)).rejects.toThrow(/append-only/);
    await expect(sql`truncate audit_events`.execute(ctx.db)).rejects.toThrow(/append-only/);
  });

  it('can be filtered by actor, entity and action', async () => {
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const byActor = await sa.get(`/admin/audit-events?actorId=${ctx.ids.opsAdmin}&action=user.`);
    expect(byActor.body.items.length).toBeGreaterThan(0);
    expect(byActor.body.items.every((e: { actorId: string }) => e.actorId === ctx.ids.opsAdmin)).toBe(true);
    const byEntity = await sa.get(`/admin/audit-events?entityType=user&entityId=${ctx.ids.employerAdminPending}`);
    expect(byEntity.body.items[0].entityLabel).toBe('Meera Employer Pending');
  });
});

describe('platform basics', () => {
  it('dashboard counts what Phase 1 holds, with an as-of time', async () => {
    const ops = await loginEmail(ctx, EMAIL.secondAdmin);
    const d = (await ops.get('/admin/dashboard')).body;
    expect(d.asOf).toBeTruthy();
    expect(d.employers.total).toBe(3);
    expect(d.partners.verified).toBe(3); // two training partners and one CSR sponsor (Phase 7)
    expect(d.awaitingAction.organisationsPendingVerification).toBe(1);
  });

  it('errors have a consistent shape with a request ID', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { 'x-request-id': 'test-req-12345' } });
    expect(res.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in', requestId: 'test-req-12345' } });
    expect(res.headers['x-request-id']).toBe('test-req-12345');
  });

  it('unknown routes return a 404 error body', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('sets security headers and disables caching of API responses', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('refuses console SMS/email providers in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', COOKIE_SECURE: 'true' })).toThrow(/not allowed when NODE_ENV=production/);
  });

  it('seed refuses to run on a database that already has users', async () => {
    const { seed } = await import('../src/db/seed.js');
    await expect(seed(ctx.db)).rejects.toThrow(/already has users/);
  });
});
