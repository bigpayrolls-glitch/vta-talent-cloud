import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/**
 * F-13 / SEC-03 — organisation isolation.
 * Every non-platform role tries to read or change the other organisation's records
 * by ID, by list filter and by request body. Any 2xx with foreign data fails the build.
 */
let ctx: Ctx;
const clients: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  for (const key of ['employerAdminA', 'recruiterA', 'partnerAdminA', 'partnerViewerA', 'centreAdmin'] as const) {
    clients[key] = await loginEmail(ctx, EMAIL[key]);
  }
  clients.trainerA = await loginPhone(ctx, PHONE.trainerA);
  clients.learner = await loginPhone(ctx, PHONE.learner);
});
afterAll(() => ctx.close());

const ALL = ['employerAdminA', 'recruiterA', 'partnerAdminA', 'partnerViewerA', 'trainerA', 'learner', 'centreAdmin'];

describe('Phase 1 test 3: no access to another organisation by ID', () => {
  const foreignReads = () => [
    { who: ['employerAdminA', 'recruiterA'], url: `/organisations/${ctx.ids.employerB}` },
    { who: ['employerAdminA', 'recruiterA'], url: `/organisations/${ctx.ids.partnerA}` },
    { who: ['partnerAdminA', 'partnerViewerA', 'trainerA'], url: `/organisations/${ctx.ids.partnerB}` },
    { who: ['partnerAdminA', 'partnerViewerA', 'trainerA'], url: `/organisations/${ctx.ids.employerA}` },
    { who: ['employerAdminA'], url: `/organisations/${ctx.ids.employerB}/members` },
    { who: ['partnerAdminA'], url: `/organisations/${ctx.ids.partnerB}/members` },
    { who: ['partnerAdminA', 'partnerViewerA', 'trainerA'], url: `/centres/${ctx.ids.centrePartnerB}` },
    { who: ['partnerAdminA', 'partnerViewerA', 'trainerA'], url: `/centres/${ctx.ids.centreVta}` },
    { who: ['centreAdmin'], url: `/centres/${ctx.ids.centrePartnerA}` },
  ];

  it('returns 404 (not 403) for out-of-scope records, so they cannot be discovered', async () => {
    for (const { who, url } of foreignReads()) {
      for (const w of who) {
        const res = await clients[w]!.get(url);
        expect(res.status, `${w} GET ${url}`).toBe(404);
      }
    }
  });

  it('the same people can read their own records', async () => {
    expect((await clients.employerAdminA!.get(`/organisations/${ctx.ids.employerA}`)).status).toBe(200);
    expect((await clients.recruiterA!.get(`/organisations/${ctx.ids.employerA}`)).status).toBe(200);
    expect((await clients.partnerAdminA!.get(`/organisations/${ctx.ids.partnerA}/members`)).status).toBe(200);
    expect((await clients.trainerA!.get(`/centres/${ctx.ids.centrePartnerA}`)).status).toBe(200);
    expect((await clients.partnerViewerA!.get(`/centres/${ctx.ids.centrePartnerA}`)).status).toBe(200);
    expect((await clients.centreAdmin!.get(`/centres/${ctx.ids.centreVta}`)).status).toBe(200);
  });
});

describe('no access to another organisation by list filter', () => {
  it('lists contain only in-scope rows, whatever filter is sent', async () => {
    const orgsA = await clients.employerAdminA!.get('/organisations?pageSize=100');
    expect(orgsA.body.items.map((o: { id: string }) => o.id)).toEqual([ctx.ids.employerA]);

    const centresA = await clients.partnerAdminA!.get(`/centres?organisationId=${ctx.ids.partnerB}`);
    expect(centresA.body.items).toEqual([]);
    const ownCentres = await clients.partnerAdminA!.get('/centres');
    expect(ownCentres.body.items.every((c: { organisationId: string }) => c.organisationId === ctx.ids.partnerA)).toBe(true);

    const trainerCentres = await clients.trainerA!.get('/centres?q=Mysuru');
    expect(trainerCentres.body.items).toEqual([]);

    const learnerOrgs = await clients.learner!.get('/organisations');
    expect(learnerOrgs.status).toBe(403);
  });
});

describe('no access by request body or to admin actions', () => {
  it('non-admins cannot grant themselves roles or create records', async () => {
    for (const w of ALL) {
      const c = clients[w]!;
      const grant = await c.post('/admin/role-assignments', { userId: ctx.ids.employerAdminA, role: 'employer_admin', organisationId: ctx.ids.employerB });
      expect(grant.status, `${w} grant`).toBe(403);
      expect((await c.post('/admin/organisations', { type: 'employer', legalName: 'Injected Org' })).status, `${w} org`).toBe(403);
      expect((await c.post('/admin/centres', { name: 'Injected Centre' })).status, `${w} centre`).toBe(403);
      expect((await c.post(`/admin/organisations/${ctx.ids.employerPending}/verify`, {})).status, `${w} verify`).toBe(403);
      expect((await c.get('/admin/audit-events')).status, `${w} audit`).toBe(403);
    }
  });

  it('a recruiter and a partner viewer cannot read team member lists', async () => {
    expect((await clients.recruiterA!.get(`/organisations/${ctx.ids.employerA}/members`)).status).toBe(403);
    expect((await clients.partnerViewerA!.get(`/organisations/${ctx.ids.partnerA}/members`)).status).toBe(403);
  });

  it('member lists never include another organisation’s people', async () => {
    const res = await clients.partnerAdminA!.get(`/organisations/${ctx.ids.partnerA}/members`);
    const ids = res.body.items.map((m: { userId: string }) => m.userId);
    expect(ids).toContain(ctx.ids.trainerA);
    expect(ids).not.toContain(ctx.ids.partnerAdminB);
    expect(ids).not.toContain(ctx.ids.multiRole);
  });
});

describe('signed-out access', () => {
  it('every non-public route answers 401 without a session', async () => {
    const routes = ctx.app.routeTable.filter((r) => !r.public);
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) {
      const url = `${r.url.replace(':id', '01a16c43-019a-7168-a9cb-590b39778a20').replace(':token', 'x'.repeat(30))}`;
      const res = await ctx.app.inject({ method: r.method as 'GET', url, payload: r.method === 'GET' ? undefined : {} });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });
});
