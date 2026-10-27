import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/**
 * Phase 2 isolation (SEC-02, SEC-03, TR-01):
 * training partners see and manage only batches at centres they run, trainers only their own batches,
 * and candidate records are visible only to Admins and to the partner running a centre where the candidate is enrolled.
 */
let ctx: Ctx;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  for (const k of ['secondAdmin', 'partnerAdminA', 'partnerAdminB', 'employerAdminA'] as const) c[k] = await loginEmail(ctx, EMAIL[k]);
  c.trainerA = await loginPhone(ctx, PHONE.trainerA);
  c.trainerVta = await loginPhone(ctx, PHONE.trainerVta);
  c.trainerFree = await loginPhone(ctx, PHONE.trainerFree);
  c.learner = await loginPhone(ctx, PHONE.learner);
});
afterAll(() => ctx.close());

const names = (r: { body: { items: { name: string }[] } }) => r.body.items.map((x) => x.name).sort();

describe('batch visibility', () => {
  it('each role lists exactly the batches it should', async () => {
    expect(names(await c.secondAdmin!.get('/batches'))).toEqual(['2W Peenya July 2026', '2W Peenya November 2026', '2W Peenya October 2026', '4W Bengaluru November 2026', 'EV Mysuru November 2026']);
    expect(names(await c.partnerAdminA!.get('/batches'))).toEqual(['2W Peenya July 2026', '2W Peenya November 2026', '2W Peenya October 2026']);
    expect(names(await c.partnerAdminB!.get('/batches'))).toEqual(['EV Mysuru November 2026']);
    expect(names(await c.trainerA!.get('/batches'))).toEqual(['2W Peenya July 2026', '2W Peenya November 2026', '2W Peenya October 2026']);
    expect(names(await c.trainerVta!.get('/batches'))).toEqual(['4W Bengaluru November 2026']);
    // An independent trainer has no batches until a partner or Admin gives them one.
    expect(names(await c.trainerFree!.get('/batches'))).toEqual([]);
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
      ['partnerAdminB', ctx.ids.batchVta!],
      ['trainerFree', ctx.ids.batchA!],
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
  it('the batch trainer and the training partner running the centre see phone numbers', async () => {
    for (const who of ['trainerA', 'partnerAdminA']) {
      const r = await c[who]!.get(`/batches/${ctx.ids.batchA}/roster`);
      expect(r.status, who).toBe(200);
      expect(r.body.showContact, who).toBe(true);
      expect(r.body.items[0].phone, who).toMatch(/^\+91/);
    }
  });
});

describe('managing batches', () => {
  it('trainers, employers and learners cannot create batches, enrol or start them', async () => {
    for (const who of ['trainerA', 'employerAdminA', 'learner']) {
      const body = { name: 'X batch', courseId: ctx.ids.course2w, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2026-12-01', endDate: '2027-01-01', capacity: 5 };
      expect((await c[who]!.post('/admin/batches', body)).status, who).toBe(403);
      expect((await c[who]!.post(`/admin/batches/${ctx.ids.batchA}/enrolments`, { candidateIds: [ctx.ids.cand4] })).status, who).toBe(403);
      expect((await c[who]!.post(`/admin/batches/${ctx.ids.batchA}/start`)).status, who).toBe(403);
    }
  });

  it('a training partner manages batches at their own centres only', async () => {
    const own = await c.partnerAdminA!.post('/admin/batches', {
      name: '2W Peenya January 2027', courseId: ctx.ids.course2w, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2027-01-11', endDate: '2027-05-11', capacity: 15,
    });
    expect(own.status).toBe(201);
    expect((await c.partnerAdminA!.post(`/admin/batches/${own.body.id}/enrolments`, { candidateIds: [ctx.ids.cand7] })).status).toBe(201);

    // The AutoTalent Grid centre is not theirs.
    const foreign = await c.partnerAdminA!.post('/admin/batches', {
      name: 'Not mine', courseId: ctx.ids.course4w, centreId: ctx.ids.centreVta, trainerId: ctx.ids.trainerVta, startDate: '2027-01-11', endDate: '2027-05-11', capacity: 15,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.fields.centreId).toBe('Not found');
    // Nor is another partner's batch.
    expect((await c.partnerAdminA!.post(`/admin/batches/${ctx.ids.batchB}/enrolments`, { candidateIds: [ctx.ids.cand7] })).status).toBe(404);
    expect((await c.partnerAdminA!.patch(`/admin/batches/${ctx.ids.batchB}`, { capacity: 30 })).status).toBe(404);
    expect((await c.partnerAdminA!.get(`/admin/batches/${ctx.ids.batchB}/candidate-options`)).status).toBe(404);
    const roster = await c.secondAdmin!.get(`/batches/${ctx.ids.batchB}/roster`);
    expect((await c.partnerAdminA!.post(`/admin/enrolments/${roster.body.items[0].enrolmentId}/withdraw`, { reason: 'Not my batch' })).status).toBe(404);
  });
});

describe('candidate records', () => {
  it('a training partner sees only candidates enrolled at their centres', async () => {
    // Partner B runs the Mysuru centre: Naveen and Pooja.
    expect(names(await c.partnerAdminB!.get('/admin/candidates'))).toEqual(['Naveen Shetty', 'Pooja Naik']);
    expect((await c.partnerAdminB!.get(`/admin/candidates/${ctx.ids.cand5}`)).status).toBe(200);
    expect((await c.partnerAdminB!.get(`/admin/candidates/${ctx.ids.cand1}`)).status).toBe(404);
    // Partner A includes Kiran, enrolled in the batch created above, but not Deepa at the AutoTalent Grid centre.
    const a = names(await c.partnerAdminA!.get('/admin/candidates'));
    expect(a).toContain('Kiran Patil');
    expect(a).toContain('Ravi Kumar');
    expect(a).not.toContain('Deepa Rao');
    expect(a).not.toContain('Naveen Shetty');
    expect((await c.partnerAdminA!.get(`/admin/candidates/${ctx.ids.cand4}`)).status).toBe(404);
  });

  it('a training partner cannot create, edit, import or approve candidates', async () => {
    expect((await c.partnerAdminA!.post('/admin/candidates', { name: 'X Y', phone: '9900000777', dateOfBirth: '2000-01-01', city: 'Mysuru' })).status).toBe(403);
    expect((await c.partnerAdminA!.patch(`/admin/candidates/${ctx.ids.cand1}`, { city: 'Mysuru' })).status).toBe(403);
    expect((await c.partnerAdminA!.post('/admin/candidates/import', { csv: 'a' })).status).toBe(403);
    expect((await c.partnerAdminA!.post(`/admin/candidates/${ctx.ids.cand7}/verify`)).status).toBe(403);
  });

  it('trainers, employers and learners cannot read candidate records', async () => {
    for (const who of ['trainerA', 'trainerFree', 'employerAdminA', 'learner']) {
      expect((await c[who]!.get('/admin/candidates')).status, who).toBe(403);
      expect((await c[who]!.get(`/admin/candidates/${ctx.ids.cand1}`)).status, who).toBe(403);
    }
  });
});

describe('trainer records', () => {
  it('training partners see their own trainers and verified independent trainers, never another partner’s', async () => {
    expect(names(await c.partnerAdminA!.get('/trainers'))).toEqual(['Arun Independent Trainer', 'Kavya New Trainer', 'Prakash Trainer']);
    expect(names(await c.partnerAdminB!.get('/trainers'))).toEqual(['Arun Independent Trainer', 'Imran Trainer B']);
    expect((await c.partnerAdminA!.get(`/trainers/${ctx.ids.trainerB}`)).status).toBe(404);
    expect((await c.partnerAdminA!.get(`/trainers/${ctx.ids.trainerVta}`)).status).toBe(404);
  });

  it('only Admins verify trainers; trainers cannot add trainers or list them', async () => {
    for (const who of ['partnerAdminA', 'trainerA']) {
      expect((await c[who]!.post(`/admin/trainers/${ctx.ids.trainerPending}/verify`)).status, who).toBe(403);
    }
    expect((await c.trainerA!.post('/admin/trainers', { name: 'New Person', phone: '9900000888', centreId: ctx.ids.centrePartnerA })).status).toBe(403);
    expect((await c.trainerA!.get('/trainers')).status).toBe(403);
  });
});
