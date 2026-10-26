import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toCsv } from '../src/lib/csv.js';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

/** Phase 7 acceptance criteria: PA-01 to PA-06, AD-10, AD-11 and the reporting definitions (§17). */
let ctx: Ctx;
const c: Record<string, Client> = {};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const get = (client: Client, url: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { cookie: client.cookie } });

const programmeBody = (over: Record<string, unknown> = {}) => ({
  name: 'EV Skills Mysuru 2027',
  partnerOrganisationIds: [ctx.ids.partnerB],
  batchIds: [ctx.ids.batchB],
  targetCount: 25,
  startDate: '2026-11-01',
  endDate: '2027-06-30',
  status: 'planned',
  ...over,
});

beforeAll(async () => {
  ctx = await setup();
  for (const k of ['opsAdmin', 'partnerAdminA', 'partnerViewerA', 'partnerAdminB', 'employerAdminA', 'centreAdmin'] as const) c[k] = await loginEmail(ctx, EMAIL[k]);
});
afterAll(() => ctx.close());

describe('PA-02 programme access', () => {
  it('the assigned partner sees its programme; another partner sees nothing and gets "not found"', async () => {
    const a = await c.partnerViewerA!.get('/programmes');
    expect(a.body.items.map((p: { id: string }) => p.id)).toEqual([ctx.ids.programmeA]);
    expect(a.body.items[0]).toMatchObject({ enrolled: 7, targetCount: 40, partners: ['Skill Bridge Foundation (demo)'] });
    expect((await c.partnerAdminB!.get('/programmes')).body.items).toEqual([]);
    for (const path of ['', '/metrics', '/beneficiaries', '/documents']) expect((await c.partnerAdminB!.get(`/programmes/${ctx.ids.programmeA}${path}`)).status).toBe(404);
    expect((await get(c.partnerAdminB!, `/programmes/${ctx.ids.programmeA}/report.csv`)).statusCode).toBe(404);
    expect((await get(c.partnerAdminB!, `/programmes/${ctx.ids.programmeA}/beneficiaries.csv`)).statusCode).toBe(404);
  });

  it('employers and centre admins have no programme access', async () => {
    expect((await c.employerAdminA!.get('/programmes')).status).toBe(403);
    expect((await c.centreAdmin!.get(`/programmes/${ctx.ids.programmeA}`)).status).toBe(403);
  });

  it('the programme shows its sponsor, batches and a budget reference with source and date', async () => {
    const p = await c.partnerAdminA!.get(`/programmes/${ctx.ids.programmeA}`);
    expect(p.body).toMatchObject({ sponsor: { name: 'Bright Lubricants CSR Foundation (demo)' }, canManage: false, canUpload: true, budget: { amount: 1200000, source: expect.any(String), asOf: '2026-07-01' } });
    expect(p.body.batches.map((b: { name: string }) => b.name).sort()).toEqual(['2W Peenya July 2026', '2W Peenya October 2026']);
    expect((await c.partnerViewerA!.get(`/programmes/${ctx.ids.programmeA}`)).body.canUpload).toBe(false);
  });
});

describe('PA-03 programme dashboard with definitions (§17)', () => {
  it('counts the cohort with a definition for every figure and a denominator for every rate', async () => {
    const { body } = await c.partnerAdminA!.get(`/programmes/${ctx.ids.programmeA}/metrics`);
    const m = Object.fromEntries(body.metrics.map((x: { key: string }) => [x.key, x]));
    expect(m.target).toMatchObject({ value: 40, basis: 'target' });
    expect(m.enrolled).toMatchObject({ value: 7, denominator: { value: 40 } });
    expect(m.enrolled.definition).toMatch(/5 different people/);
    expect(m.active.value).toBe(4); // everyone in the running batch attended in the last 14 days
    expect(m.completed).toMatchObject({ value: 2, denominator: { label: 'enrolments in finished batches', value: 3 } });
    expect(m.assessed.value).toBe(2);
    expect(m.passed).toMatchObject({ value: 2, denominator: { label: 'assessed', value: 2 } });
    expect(m.certified.value).toBe(1);
    expect(m.offers.basis).toBe('employer_reported');
    expect(m.joined_verified).toMatchObject({ basis: 'vta_verified', denominator: { label: 'people who completed', value: 2 } });
    for (const x of body.metrics) expect(x.definition.length).toBeGreaterThan(20);
  });

  it('a verified joining after enrolment counts; an offer alone does not count as joined', async () => {
    const anitha = await ctx.db.selectFrom('job_applications').select('id').where('id', '=', ctx.ids.applicationAnitha!).executeTakeFirstOrThrow();
    await ctx.db.updateTable('job_applications').set({ status: 'offer' }).where('id', '=', anitha.id).execute();
    let m = Object.fromEntries((await c.opsAdmin!.get(`/programmes/${ctx.ids.programmeA}/metrics`)).body.metrics.map((x: { key: string; value: number }) => [x.key, x.value]));
    expect(m).toMatchObject({ offers: 1, joined: 0, joined_verified: 0 });
    await ctx.db.updateTable('job_applications').set({ status: 'joined', joining_date: '2026-10-20', outcome_verification: 'verified' }).where('id', '=', anitha.id).execute();
    m = Object.fromEntries((await c.opsAdmin!.get(`/programmes/${ctx.ids.programmeA}/metrics`)).body.metrics.map((x: { key: string; value: number }) => [x.key, x.value]));
    expect(m).toMatchObject({ offers: 1, joined: 1, joined_verified: 1 });
  });
});

describe('PA-04 beneficiaries: only approved fields', () => {
  it('names, mobile numbers and dates of birth are hidden by default', async () => {
    const { body } = await c.partnerViewerA!.get(`/programmes/${ctx.ids.programmeA}/beneficiaries`);
    expect(body.items).toHaveLength(7);
    expect(Object.keys(body.items[0]).sort()).toEqual(['assessment', 'attendance', 'batch', 'candidateCode', 'certificate', 'city', 'employment', 'enrolmentStatus']);
    expect(JSON.stringify(body)).not.toMatch(/Ravi|Anitha|\+91|2002-08-01/);
    const ravi = body.items.find((r: { candidateCode: string; batch: string; certificate: string }) => r.batch === '2W Peenya July 2026' && r.certificate === 'Issued');
    expect(ravi).toMatchObject({ enrolmentStatus: 'completed', assessment: 'Passed' });
  });

  it('VTA can approve names only with a recorded basis; the change is audited', async () => {
    const current = (await c.opsAdmin!.get(`/programmes/${ctx.ids.programmeA}`)).body;
    const body = {
      name: current.name,
      sponsorOrganisationId: current.sponsor.id,
      partnerOrganisationIds: current.partners.map((p: { id: string }) => p.id),
      batchIds: current.batches.map((b: { id: string }) => b.id),
      targetCount: current.targetCount,
      startDate: current.startDate,
      endDate: current.endDate,
      status: current.status,
      beneficiaryFields: [...current.beneficiaryFields, 'name'],
      budgetReference: current.budget.reference,
      budgetAmount: current.budget.amount,
      budgetSource: current.budget.source,
      budgetAsOf: current.budget.asOf,
    };
    const refused = await c.opsAdmin!.put(`/admin/programmes/${ctx.ids.programmeA}`, body);
    expect(refused.body.error.fields.sharingBasis).toMatch(/Record the basis/);
    const ok = await c.opsAdmin!.put(`/admin/programmes/${ctx.ids.programmeA}`, { ...body, sharingBasis: 'Beneficiary consent forms collected by Skill Bridge (demo)' });
    expect(ok.status).toBe(200);
    const list = (await c.partnerViewerA!.get(`/programmes/${ctx.ids.programmeA}/beneficiaries`)).body;
    expect(list.sharingBasis).toMatch(/consent forms/);
    expect(list.items.map((r: { name: string }) => r.name)).toContain('Ravi Kumar');
    const ev = await ctx.db.selectFrom('audit_events').select('after').where('action', '=', 'programme.updated').executeTakeFirstOrThrow();
    expect(ev.after).toMatchObject({ beneficiaryFields: expect.arrayContaining(['name']) });
    // Put it back for the rest of the tests.
    expect((await c.opsAdmin!.put(`/admin/programmes/${ctx.ids.programmeA}`, { ...body, beneficiaryFields: current.beneficiaryFields })).status).toBe(200);
  });

  it('partners cannot create or change programmes', async () => {
    expect((await c.partnerAdminA!.post('/admin/programmes', programmeBody())).status).toBe(403);
    expect((await c.partnerAdminA!.put(`/admin/programmes/${ctx.ids.programmeA}`, programmeBody())).status).toBe(403);
  });
});

describe('PA-06 / AD-11 reports and exports', () => {
  it('the programme report is aggregate only, downloads as CSV and is logged', async () => {
    const res = await get(c.partnerViewerA!, `/programmes/${ctx.ids.programmeA}/report.csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/two-wheeler-livelihoods-bengaluru-2026-outcomes\.csv/);
    expect(res.body).toMatch(/No personal data/);
    expect(res.body).toMatch(/Joined \(VTA-verified\)/);
    expect(res.body).not.toMatch(/Ravi|Anitha|VTA26/);
    const ev = await ctx.db.selectFrom('audit_events').select(['actor_id', 'after']).where('action', '=', 'report.exported').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(ev).toMatchObject({ actor_id: ctx.ids.partnerViewerA, after: { report: 'programme_outcomes', personalData: false } });
  });

  it('the beneficiary download has only the approved columns and is logged with what was exported', async () => {
    const res = await get(c.partnerAdminA!, `/programmes/${ctx.ids.programmeA}/beneficiaries.csv`);
    const header = res.body.replace(/^﻿/, '').split('\r\n')[0];
    expect(header).toBe('Candidate ID,City,Batch,Enrolment status,Attendance %,Assessment result,VTA certificate,Employment outcome');
    expect(res.body).not.toMatch(/Ravi Kumar/);
    const ev = await ctx.db.selectFrom('audit_events').select('after').where('action', '=', 'report.exported').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(ev.after).toMatchObject({ report: 'beneficiaries', rows: 7 });
  });

  it('exported cells cannot carry spreadsheet formulas', () => {
    expect(toCsv([['=HYPERLINK("x")', '+91 9', 'a,b', 'ok']])).toBe('﻿"\'=HYPERLINK(""x"")",\'+91 9,"a,b",ok\r\n');
  });

  it('VTA filters the cohort report by programme, partner, course and dates', async () => {
    const byProgramme = await c.opsAdmin!.get(`/admin/reports/cohort?programmeId=${ctx.ids.programmeA}`);
    expect(byProgramme.body).toMatchObject({ batches: 2, filters: { programme: 'Two-Wheeler Livelihoods Bengaluru 2026' } });
    const byPartnerB = await c.opsAdmin!.get(`/admin/reports/cohort?partnerId=${ctx.ids.partnerB}`);
    expect(byPartnerB.body.metrics.find((m: { key: string }) => m.key === 'enrolled').value).toBe(2);
    const dated = await c.opsAdmin!.get('/admin/reports/cohort?from=2026-10-01&to=2026-10-31');
    expect(dated.body.batches).toBe(1); // only the October batch starts in October
    const csv = await get(c.opsAdmin!, `/admin/reports/cohort.csv?partnerId=${ctx.ids.partnerA}`);
    expect(csv.body).toMatch(/Partner,Skill Bridge Foundation \(demo\)/);
    expect((await c.partnerAdminA!.get('/admin/reports/cohort')).status).toBe(403);
  });
});

describe('PA-05 programme documents', () => {
  let docId = '';
  it('the partner admin uploads; the viewer can open but not upload; another partner cannot', async () => {
    const up = await c.partnerAdminA!.upload(`/programmes/${ctx.ids.programmeA}/documents?title=Work%20order%202026&fileName=wo.pdf&category=work_order`, PDF);
    expect(up.status).toBe(201);
    docId = up.body.id;
    expect((await c.partnerViewerA!.upload(`/programmes/${ctx.ids.programmeA}/documents?title=x&fileName=x.pdf&category=other`, PDF)).status).toBe(403);
    const list = await c.partnerViewerA!.get(`/programmes/${ctx.ids.programmeA}/documents`);
    expect(list.body.items[0]).toMatchObject({ title: 'Work order 2026', category: 'work_order', uploadedBy: 'Farah Partner A' });
    expect((await c.partnerViewerA!.get(`/programmes/${ctx.ids.programmeA}/documents/${docId}/link`)).status).toBe(200);
    expect((await c.partnerAdminB!.get(`/programmes/${ctx.ids.programmeA}/documents/${docId}/link`)).status).toBe(404);
  });
});

describe('AD-10 creating programmes', () => {
  it('VTA creates a programme for a partner; the partner then sees it', async () => {
    const bad = await c.opsAdmin!.post('/admin/programmes', programmeBody({ partnerOrganisationIds: [ctx.ids.employerA], endDate: '2026-01-01', budgetAmount: 50000 }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['endDate', 'budgetSource']));
    const notPartner = await c.opsAdmin!.post('/admin/programmes', programmeBody({ partnerOrganisationIds: [ctx.ids.employerA] }));
    expect(notPartner.body.error.fields.partnerOrganisationIds).toBeDefined();
    const ok = await c.opsAdmin!.post('/admin/programmes', programmeBody());
    expect(ok.status).toBe(201);
    expect((await c.partnerAdminB!.get('/programmes')).body.items.map((p: { name: string }) => p.name)).toEqual(['EV Skills Mysuru 2027']);
    expect((await c.partnerAdminA!.get(`/programmes/${ok.body.id}`)).status).toBe(404);
  });
});

describe('PA-01 partner organisation profile', () => {
  it('the partner admin updates the profile; the viewer can only read; sending needs a document', async () => {
    const body = {
      legalName: 'Skill Bridge Foundation (demo)',
      partnerSubtype: 'ngo',
      city: 'Bengaluru',
      registrationNumber: 'NGO-KA-2019-001',
      programmeInterests: 'Two-wheeler and EV technician training for young people',
      contactName: 'Farah Partner A',
      contactEmail: 'partner-a@demo.vta.local',
      contactPhone: '9900000401',
    };
    // Verified already: the registered name and number are locked.
    const locked = await c.partnerAdminA!.put('/partner/organisation', body);
    expect(locked.body.error.fields.legalName).toBe('Verified by VTA');
    const ok = await c.partnerAdminA!.put('/partner/organisation', { ...body, registrationNumber: undefined });
    expect(ok.body).toMatchObject({ city: 'Bengaluru', programmeInterests: expect.stringMatching(/EV technician/), identityLocked: true });
    expect((await c.partnerViewerA!.get('/partner/organisation')).body.programmeInterests).toMatch(/EV/);
    expect((await c.partnerViewerA!.put('/partner/organisation', body)).status).toBe(403);
    expect((await c.partnerAdminA!.post('/partner/organisation/submit')).body.error.message).toMatch(/already verified/);
    // VTA sees the interests when reviewing.
    expect((await c.opsAdmin!.get(`/admin/organisations/${ctx.ids.partnerA}/company`)).body.programmeInterests).toMatch(/EV/);
  });
});
