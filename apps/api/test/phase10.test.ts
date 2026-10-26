import { NOTICE_VERSION } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMaintenance } from '../src/db/maintenance.js';
import { newId } from '../src/lib/crypto.js';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 10 fixes found in the pilot-readiness review. */
let ctx: Ctx;
const c: Record<string, Client> = {};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

beforeAll(async () => {
  ctx = await setup();
  c.ops = await loginEmail(ctx, EMAIL.opsAdmin);
  c.centre = await loginEmail(ctx, EMAIL.centreAdmin);
  c.learner = await loginPhone(ctx, PHONE.learner);
});
afterAll(() => ctx.close());

describe('AD-05 document verification', () => {
  let learnerId = '';
  let docA = '';
  let docB = '';

  it('VTA verifies a learner document; the learner can then no longer delete it', async () => {
    learnerId = (await ctx.db.selectFrom('users').select('id').where('phone', '=', PHONE.learner).executeTakeFirstOrThrow()).id;
    docA = (await c.learner!.upload('/me/documents?kind=certificate&title=ITI%20certificate&fileName=iti.pdf', PDF)).body.id;
    docB = (await c.learner!.upload('/me/documents?kind=other&title=Blurry%20photo&fileName=b.pdf', PDF)).body.id;

    const ok = await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docA}/review`, { decision: 'verified' });
    expect(ok.body).toEqual({ id: docA, verificationStatus: 'verified' });
    const mine = (await c.learner!.get('/me/documents')).body.items.find((d: { id: string }) => d.id === docA);
    expect(mine).toMatchObject({ verificationStatus: 'verified', canDelete: false, reviewReason: null });
    expect((await c.learner!.del(`/me/documents/${docA}`)).status).toBe(403);
    expect((await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docA}/review`, { decision: 'verified' })).status).toBe(400);
  });

  it('rejecting needs a reason, which the learner sees and is notified about', async () => {
    const noReason = await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docB}/review`, { decision: 'rejected' });
    expect(noReason.body.error.fields.reason).toBe('Give a reason');
    await c.ops!.post(`/admin/candidates/${learnerId}/documents/${docB}/review`, { decision: 'rejected', reason: 'The photo is too blurry to read' });
    const mine = (await c.learner!.get('/me/documents')).body.items.find((d: { id: string }) => d.id === docB);
    expect(mine).toMatchObject({ verificationStatus: 'rejected', reviewReason: 'The photo is too blurry to read', canDelete: true });
    const n = (await c.learner!.get('/notifications')).body.items[0];
    expect(n).toMatchObject({ title: 'VTA could not accept "Blurry photo"', link: '/learn/documents' });
    const detail = (await c.ops!.get(`/admin/candidates/${learnerId}`)).body.documents.find((d: { id: string }) => d.id === docB);
    expect(detail.reviewReason).toBe('The photo is too blurry to read');
    const logged = await ctx.db.selectFrom('audit_events').select('action').where('entity_id', '=', learnerId).where('action', 'in', ['document.verified', 'document.rejected']).execute();
    expect(logged.map((l) => l.action).sort()).toEqual(['document.rejected', 'document.verified']);
  });

  it('only VTA operations can review; a document must belong to that candidate', async () => {
    expect((await c.centre!.post(`/admin/candidates/${learnerId}/documents/${docB}/review`, { decision: 'verified' })).status).toBe(403);
    const other = (await ctx.db.selectFrom('candidate_profiles').select('user_id').where('user_id', '!=', learnerId).executeTakeFirstOrThrow()).user_id;
    expect((await c.ops!.post(`/admin/candidates/${other}/documents/${docB}/review`, { decision: 'verified' })).status).toBe(404);
  });
});

describe('maintenance job', () => {
  const signup = (email: string, legalName: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/public/organisations/register',
      remoteAddress: `10.77.0.${Math.floor(Math.random() * 200) + 1}`,
      payload: { type: 'employer', legalName, sector: 'fleet', city: 'Pune', contactName: 'Old Signup', email, phone: '9876511111', acceptPrivacy: true, acceptTerms: true, noticeVersion: NOTICE_VERSION },
    });

  it('clears old codes, sessions and reset links, and closes sign-ups never confirmed in 30 days', async () => {
    await signup('stale@signup.example', 'Stale Garage');
    await signup('fresh@signup.example', 'Fresh Garage');
    const stale = await ctx.db.selectFrom('organisations').select('id').where('legal_name', '=', 'Stale Garage').executeTakeFirstOrThrow();
    await ctx.db.updateTable('organisations').set({ created_at: new Date(Date.now() - 31 * 86_400_000) }).where('id', '=', stale.id).execute();
    await ctx.db.insertInto('otp_challenges').values({ id: newId(), phone: '+919811111111', code_hash: 'x', purpose: 'login', expires_at: new Date(Date.now() - 2 * 86_400_000), created_at: new Date(Date.now() - 2 * 86_400_000) } as never).execute();

    const r = await runMaintenance(ctx.db);
    expect(r.signupsClosed).toBe(1);
    expect(r.otpChallengesDeleted).toBeGreaterThanOrEqual(1);
    const org = await ctx.db.selectFrom('organisations').select(['verification_status', 'status', 'verification_reason']).where('id', '=', stale.id).executeTakeFirstOrThrow();
    expect(org).toMatchObject({ verification_status: 'rejected', status: 'inactive' });
    expect(org.verification_reason).toMatch(/Email not confirmed within 30 days/);
    expect((await ctx.db.selectFrom('users').select('status').where('email', '=', 'stale@signup.example').executeTakeFirstOrThrow()).status).toBe('deactivated');
    expect((await ctx.db.selectFrom('organisations').select('verification_status').where('legal_name', '=', 'Fresh Garage').executeTakeFirstOrThrow()).verification_status).toBe('pending');
    // The old link no longer works.
    const oldToken = ctx.mem.sentInvites.get('stale@signup.example')!.split('/invite/')[1];
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${oldToken}` })).statusCode).toBe(404);
    // Running again changes nothing more.
    expect((await runMaintenance(ctx.db)).signupsClosed).toBe(0);
  });

  it('registering again with that email reopens the sign-up with the new details', async () => {
    ctx.mem.sentInvites.clear();
    const r = await signup('stale@signup.example', 'Stale Garage Pvt Ltd');
    expect(r.statusCode).toBe(202);
    const token = ctx.mem.sentInvites.get('stale@signup.example')!.split('/invite/')[1]!;
    const org = await ctx.db.selectFrom('organisations').select(['legal_name', 'verification_status', 'status']).where('contact_email', '=', 'stale@signup.example').execute();
    expect(org).toEqual([{ legal_name: 'Stale Garage Pvt Ltd', verification_status: 'pending', status: 'active' }]);
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/v1/auth/invitations/${token}/accept`, payload: { password: 'A-strong-pass-42' } });
    expect(ok.statusCode).toBe(200);
  });

  it('a deactivated account that was not an expired sign-up is never reopened', async () => {
    ctx.mem.sentInvites.clear();
    await ctx.db.updateTable('users').set({ status: 'deactivated' }).where('email', '=', EMAIL.partnerViewerA).execute();
    expect((await signup(EMAIL.partnerViewerA, 'Sneaky Org')).statusCode).toBe(202);
    expect(ctx.mem.sentInvites.size).toBe(0);
    expect(await ctx.db.selectFrom('organisations').select('id').where('legal_name', '=', 'Sneaky Org').executeTakeFirst()).toBeUndefined();
  });
});

describe('tests the traceability review found missing', () => {
  it('EM-07: an interview outcome is recorded; private notes stay with the employer', async () => {
    const rec = await loginEmail(ctx, EMAIL.recruiterA);
    const app = ctx.ids.applicationAnitha!;
    const made = await rec.post(`/employer/applications/${app}/interviews`, { scheduledAt: '2026-10-24T11:00:00+05:30', mode: 'phone' });
    expect(made.status).toBe(201);
    const upd = await rec.put(`/employer/interviews/${made.body.id}`, { scheduledAt: '2026-10-24T11:00:00+05:30', mode: 'phone', outcome: 'passed', internalNotes: 'Strong on brakes; slow on electricals' });
    expect(upd.status).toBe(200);
    const detail = (await rec.get(`/employer/applications/${app}`)).body;
    expect(detail.interviews[0]).toMatchObject({ outcome: 'passed', internalNotes: 'Strong on brakes; slow on electricals' });
    const anitha = await loginPhone(ctx, '+919900000212');
    const mine = (await anitha.get(`/me/applications/${app}`)).body;
    expect(JSON.stringify(mine)).not.toContain('slow on electricals');
  });

  it('EM-08: VTA can flag a recorded joining with a note', async () => {
    const rec = await loginEmail(ctx, EMAIL.recruiterA);
    const app = ctx.ids.applicationAnitha!;
    expect((await rec.post(`/employer/applications/${app}/move`, { to: 'offer' })).status).toBe(200);
    expect((await rec.post(`/employer/applications/${app}/move`, { to: 'joined', joiningDate: '2026-10-25' })).status).toBe(200);
    const flagged = await c.ops!.post(`/admin/applications/${app}/outcome-review`, { decision: 'flagged', note: 'Employer could not confirm the start date by phone' });
    expect(flagged.status).toBe(200);
    const row = await ctx.db.selectFrom('job_applications').select(['outcome_verification', 'outcome_note']).where('id', '=', app).executeTakeFirstOrThrow();
    expect(row).toEqual({ outcome_verification: 'flagged', outcome_note: 'Employer could not confirm the start date by phone' });
  });

  it('AD-11: the cohort report filters by course and by centre', async () => {
    const countBatches = async (col: 'course_id' | 'centre_id', id: string) =>
      Number((await ctx.db.selectFrom('batches').select((eb) => eb.fn.countAll<string>().as('n')).where(col, '=', id).where('status', '!=', 'cancelled').executeTakeFirstOrThrow()).n);
    const all = (await c.ops!.get('/admin/reports/cohort')).body.batches;
    const byCourse = (await c.ops!.get(`/admin/reports/cohort?courseId=${ctx.ids.course4w}`)).body.batches;
    const byCentre = (await c.ops!.get(`/admin/reports/cohort?centreId=${ctx.ids.centrePartnerA}`)).body.batches;
    expect(byCourse).toBe(await countBatches('course_id', ctx.ids.course4w!));
    expect(byCentre).toBe(await countBatches('centre_id', ctx.ids.centrePartnerA!));
    expect(byCourse).toBeLessThan(all);
    expect(byCentre).toBeLessThan(all);
  });
});

describe('SH-09 programme lists are paged and searchable', () => {
  it('pages, searches by name and filters by status; partners still see only their own', async () => {
    const all = (await c.ops!.get('/programmes')).body;
    expect(all).toMatchObject({ page: 1, pageSize: 20 });
    expect(all.total).toBeGreaterThanOrEqual(1);
    const name = all.items[0].name as string;
    expect((await c.ops!.get(`/programmes?q=${encodeURIComponent(name.slice(0, 6))}`)).body.items.map((p: { name: string }) => p.name)).toContain(name);
    expect((await c.ops!.get('/programmes?q=zzzz-no-such')).body).toMatchObject({ items: [], total: 0 });
    expect((await c.ops!.get('/programmes?status=closed')).body.items.every((p: { status: string }) => p.status === 'closed')).toBe(true);
    expect((await c.ops!.get('/programmes?pageSize=101')).status).toBe(400);
    const partnerB = await loginEmail(ctx, EMAIL.partnerAdminB);
    expect((await partnerB.get('/programmes')).body).toMatchObject({ items: [], total: 0 });
  });

  it('beneficiaries come back a page at a time with a total', async () => {
    const b = (await c.ops!.get(`/programmes/${ctx.ids.programmeA}/beneficiaries?pageSize=1`)).body;
    expect(b.items).toHaveLength(Math.min(1, b.total));
    expect(b).toMatchObject({ page: 1, pageSize: 1 });
  });
});
