import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/**
 * Phase 2 isolation (SEC-02, SEC-03, TR-01):
 * partners see only batches at their centres, trainers only their own batches,
 * centre admins manage only their centre, and nobody outside the admin team sees candidate records.
 */
let ctx: Ctx;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  for (const k of ['opsAdmin', 'centreAdmin', 'partnerAdminA', 'partnerViewerA', 'partnerAdminB', 'employerAdminA'] as const) c[k] = await loginEmail(ctx, EMAIL[k]);
  c.trainerA = await loginPhone(ctx, PHONE.trainerA);
  c.trainerVta = await loginPhone(ctx, PHONE.trainerVta);
  c.learner = await loginPhone(ctx, PHONE.learner);
});
afterAll(() => ctx.close());

const names = (r: { body: { items: { name: string }[] } }) => r.body.items.map((x) => x.name).sort();

describe('batch visibility', () => {
  it('each role lists exactly the batches it should', async () => {
    expect(names(await c.opsAdmin!.get('/batches'))).toEqual(['2W Peenya July 2026', '2W Peenya October 2026', '4W Bengaluru November 2026', 'EV Mysuru November 2026']);
    expect(names(await c.partnerAdminA!.get('/batches'))).toEqual(['2W Peenya July 2026', '2W Peenya October 2026']);
    expect(names(await c.partnerViewerA!.get('/batches'))).toEqual(['2W Peenya July 2026', '2W Peenya October 2026']);
    expect(names(await c.partnerAdminB!.get('/batches'))).toEqual(['EV Mysuru November 2026']);
    expect(names(await c.trainerA!.get('/batches'))).toEqual(['2W Peenya July 2026', '2W Peenya October 2026']);
    expect(names(await c.trainerVta!.get('/batches'))).toEqual(['4W Bengaluru November 2026']);
    expect(names(await c.centreAdmin!.get('/batches'))).toEqual(['4W Bengaluru November 2026']);
  });

  it('filters cannot widen the scope', async () => {
    const r = await c.partnerAdminA!.get(`/batches?centreId=${ctx.ids.centrePartnerB}`);
    expect(r.body.items).toEqual([]);
    const t = await c.trainerA!.get(`/batches?trainerId=${ctx.ids.trainerB}`);
    expect(t.body.items).toEqual([]);
  });

  it('out-of-scope batches and rosters are "not found"', async () => {
    const cases: [string, string][] = [
      ['partnerAdminA', ctx.ids.batchB!],
      ['partnerAdminA', ctx.ids.batchVta!],
      ['partnerAdminB', ctx.ids.batchA!],
      ['trainerA', ctx.ids.batchVta!],
      ['trainerA', ctx.ids.batchB!],
      ['trainerVta', ctx.ids.batchA!],
      ['centreAdmin', ctx.ids.batchA!],
    ];
    for (const [who, id] of cases) {
      expect((await c[who]!.get(`/batches/${id}`)).status, `${who} batch`).toBe(404);
      expect((await c[who]!.get(`/batches/${id}/roster`)).status, `${who} roster`).toBe(404);
    }
  });

  it('a trainer stops seeing a batch when their role at that centre is removed', async () => {
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const ra = await ctx.db.selectFrom('role_assignments').select('id').where('user_id', '=', ctx.ids.trainerVta!).where('role', '=', 'trainer').executeTakeFirstOrThrow();
    // Give a second centre so the account still has a portal, then remove the VTA centre.
    await sa.post('/admin/role-assignments', { userId: ctx.ids.trainerVta, role: 'trainer', centreId: ctx.ids.centrePartnerB });
    await sa.post(`/admin/role-assignments/${ra.id}/revoke`);
    expect((await c.trainerVta!.get(`/batches/${ctx.ids.batchVta}`)).status).toBe(404);
    // Not assigned to batch B, so a centre role alone does not show it to a trainer
    expect((await c.trainerVta!.get(`/batches/${ctx.ids.batchB}`)).status).toBe(404);

    // Put things back for the tests that follow.
    await sa.post('/admin/role-assignments', { userId: ctx.ids.trainerVta, role: 'trainer', centreId: ctx.ids.centreVta });
    const extra = await ctx.db.selectFrom('role_assignments').select('id').where('user_id', '=', ctx.ids.trainerVta!).where('centre_id', '=', ctx.ids.centrePartnerB!).where('revoked_at', 'is', null).executeTakeFirstOrThrow();
    await sa.post(`/admin/role-assignments/${extra.id}/revoke`);
    expect((await c.trainerVta!.get(`/batches/${ctx.ids.batchVta}`)).status).toBe(200);
  });

  it('employers and learners have no access to batches or courses yet', async () => {
    for (const who of ['employerAdminA', 'learner']) {
      expect((await c[who]!.get('/batches')).status, who).toBe(403);
      expect((await c[who]!.get('/courses')).status, who).toBe(403);
    }
  });
});

describe('roster contact details', () => {
  it('trainers see phone numbers for their batch; partner admins and viewers do not', async () => {
    const t = await c.trainerA!.get(`/batches/${ctx.ids.batchA}/roster`);
    expect(t.body.showContact).toBe(true);
    expect(t.body.items[0].phone).toMatch(/^\+91/);
    for (const who of ['partnerAdminA', 'partnerViewerA']) {
      const r = await c[who]!.get(`/batches/${ctx.ids.batchA}/roster`);
      expect(r.status).toBe(200);
      expect(r.body.showContact, who).toBe(false);
      expect(r.body.items.every((x: object) => !('phone' in x)), who).toBe(true);
    }
  });
});

describe('managing batches', () => {
  it('partners and trainers cannot create batches, enrol or withdraw', async () => {
    for (const who of ['partnerAdminA', 'partnerViewerA', 'trainerA']) {
      const body = { name: 'X batch', courseId: ctx.ids.course2w, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2026-12-01', endDate: '2027-01-01', capacity: 5 };
      expect((await c[who]!.post('/admin/batches', body)).status, who).toBe(403);
      expect((await c[who]!.post(`/admin/batches/${ctx.ids.batchA}/enrolments`, { candidateIds: [ctx.ids.cand4] })).status, who).toBe(403);
      expect((await c[who]!.post(`/admin/batches/${ctx.ids.batchA}/start`)).status, who).toBe(403);
    }
  });

  it('a centre admin manages batches at their centre only', async () => {
    const own = await c.centreAdmin!.post('/admin/batches', {
      name: '4W Bengaluru January 2027', courseId: ctx.ids.course4w, centreId: ctx.ids.centreVta, trainerId: ctx.ids.trainerVta, startDate: '2027-01-11', endDate: '2027-05-11', capacity: 15,
    });
    expect(own.status).toBe(201);
    expect((await c.centreAdmin!.post(`/admin/batches/${own.body.id}/enrolments`, { candidateIds: [ctx.ids.cand7] })).status).toBe(201);

    const foreign = await c.centreAdmin!.post('/admin/batches', {
      name: 'Not mine', courseId: ctx.ids.course2w, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2027-01-11', endDate: '2027-05-11', capacity: 15,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.fields.centreId).toBe('Not found');
    expect((await c.centreAdmin!.post(`/admin/batches/${ctx.ids.batchA}/enrolments`, { candidateIds: [ctx.ids.cand7] })).status).toBe(404);
    expect((await c.centreAdmin!.patch(`/admin/batches/${ctx.ids.batchA}`, { capacity: 30 })).status).toBe(404);
    expect((await c.centreAdmin!.get(`/admin/batches/${ctx.ids.batchA}/candidate-options`)).status).toBe(404);
    const roster = await c.opsAdmin!.get(`/batches/${ctx.ids.batchA}/roster`);
    expect((await c.centreAdmin!.post(`/admin/enrolments/${roster.body.items[0].enrolmentId}/withdraw`, { reason: 'Not my batch' })).status).toBe(404);
  });
});

describe('candidate records', () => {
  it('a centre admin sees only candidates enrolled at their centre', async () => {
    const list = await c.centreAdmin!.get('/admin/candidates');
    // Deepa from the seeded VTA batch, Kiran from the batch this centre admin created above.
    expect(names(list)).toEqual(['Deepa Rao', 'Kiran Patil']);
    expect((await c.centreAdmin!.get(`/admin/candidates/${ctx.ids.cand4}`)).status).toBe(200);
    expect((await c.centreAdmin!.get(`/admin/candidates/${ctx.ids.cand1}`)).status).toBe(404);
  });

  it('a centre admin cannot create, edit, import or approve candidates', async () => {
    expect((await c.centreAdmin!.post('/admin/candidates', { name: 'X Y', phone: '9900000777', dateOfBirth: '2000-01-01', city: 'Mysuru' })).status).toBe(403);
    expect((await c.centreAdmin!.patch(`/admin/candidates/${ctx.ids.cand4}`, { city: 'Mysuru' })).status).toBe(403);
    expect((await c.centreAdmin!.post('/admin/candidates/import', { csv: 'a' })).status).toBe(403);
    expect((await c.centreAdmin!.post(`/admin/candidates/${ctx.ids.cand4}/verify`)).status).toBe(403);
  });

  it('partners, trainers, employers and learners cannot read candidate records', async () => {
    for (const who of ['partnerAdminA', 'partnerViewerA', 'trainerA', 'employerAdminA', 'learner']) {
      expect((await c[who]!.get('/admin/candidates')).status, who).toBe(403);
      expect((await c[who]!.get(`/admin/candidates/${ctx.ids.cand1}`)).status, who).toBe(403);
    }
  });
});

describe('trainer records', () => {
  it('partner admins see only their own trainers; centre admins those at their centre', async () => {
    expect(names(await c.partnerAdminA!.get('/trainers'))).toEqual(['Kavya New Trainer', 'Prakash Trainer']);
    expect(names(await c.partnerAdminB!.get('/trainers'))).toEqual(['Imran Trainer B']);
    expect(names(await c.centreAdmin!.get('/trainers'))).toEqual(['Suresh AutoTalent Grid Trainer']);
    expect((await c.partnerAdminA!.get(`/trainers/${ctx.ids.trainerB}`)).status).toBe(404);
  });

  it('only AutoTalent Grid admins add or verify trainers', async () => {
    for (const who of ['partnerAdminA', 'centreAdmin', 'trainerA']) {
      expect((await c[who]!.post(`/admin/trainers/${ctx.ids.trainerPending}/verify`)).status, who).toBe(403);
      expect((await c[who]!.post('/admin/trainers', { name: 'New Person', phone: '9900000888', centreId: ctx.ids.centrePartnerA })).status, who).toBe(403);
    }
    expect((await c.partnerViewerA!.get('/trainers')).status).toBe(403);
  });
});
