import { NOTICE_VERSION } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 6 acceptance criteria: EM-01 to EM-10, EE-07 to EE-09, AD-09 (employer portal and hiring). */
let ctx: Ctx;
const c: Record<string, Client> = {};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const RAVI = '+919900000211';
const ANITHA = '+919900000212';

const newJob = (over: Record<string, unknown> = {}) => ({
  title: 'EV battery technician',
  skillArea: 'EV',
  skills: ['Battery diagnostics'],
  minExperienceMonths: 6,
  city: 'Bengaluru',
  location: 'Whitefield',
  salaryMin: 18000,
  salaryMax: 24000,
  openings: 2,
  shift: 'Day shift',
  description: 'Diagnose and service electric scooter batteries and controllers in our workshop.',
  closingDate: '2026-12-31',
  vtaCertificatePreferred: true,
  ...over,
});

beforeAll(async () => {
  ctx = await setup();
  for (const k of ['employerAdminA', 'employerAdminB', 'employerAdminPending', 'secondAdmin', 'partnerAdminA'] as const) c[k] = await loginEmail(ctx, EMAIL[k]);
  c.learner = await loginPhone(ctx, PHONE.learner);
  c.ravi = await loginPhone(ctx, RAVI);
  c.anitha = await loginPhone(ctx, ANITHA);
  for (const purpose of ['privacy_notice', 'terms'] as const) await c.ravi.post('/me/consents', { purpose, granted: true, noticeVersion: NOTICE_VERSION });
});
afterAll(() => ctx.close());

describe('EM-01 / EM-02 company onboarding and the one employer login', () => {
  it('a pending employer completes the profile, uploads a document and sends it to AutoTalent Grid', async () => {
    const p = c.employerAdminPending!;
    const missing = await p.post('/employer/company/submit');
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.documents).toBeDefined();

    const saved = await p.put('/employer/company', {
      legalName: 'Green Volt EV Garage (demo)',
      sector: 'ev_service',
      city: 'Bengaluru',
      gstin: '29ABCDE1234F1Z5',
      contactName: 'Meera Employer Pending',
      contactEmail: 'employer-pending@demo.vta.local',
      contactPhone: '9900000303',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ sector: 'ev_service', gstin: '29ABCDE1234F1Z5', verificationStatus: 'pending', identityLocked: false });
    expect((await p.upload('/employer/company/documents?title=GST%20certificate&fileName=gst.pdf', PDF)).status).toBe(201);
    const sent = await p.post('/employer/company/submit');
    expect(sent.body.submittedAt).toBeTruthy();

    // VTA sees the profile and documents to verify them.
    const view = await c.secondAdmin!.get(`/admin/organisations/${ctx.ids.employerPending}/company`);
    expect(view.body.documents).toHaveLength(1);
    expect((await c.secondAdmin!.get(`/admin/organisations/${ctx.ids.employerPending}/documents/${view.body.documents[0].id}/link`)).status).toBe(200);
  });

  it('an unverified employer cannot send jobs for review or search candidates', async () => {
    const p = c.employerAdminPending!;
    const draft = await p.post('/employer/jobs', newJob());
    expect(draft.status).toBe(201); // drafts are fine
    const submit = await p.post(`/employer/jobs/${draft.body.id}/submit`);
    expect(submit.status).toBe(403);
    expect(submit.body.error.message).toMatch(/AutoTalent Grid needs to verify your company/);
    expect((await p.get('/employer/candidates')).status).toBe(403);
  });

  it('a company with the same GSTIN or name as another is flagged as a possible duplicate', async () => {
    await c.employerAdminB!.put('/employer/company', {
      legalName: 'Metro Auto Works (demo)',
      sector: 'dealership',
      city: 'Mysuru',
      gstin: '29ABCDE1234F1Z5',
      contactName: 'Kiran Employer B',
      contactEmail: 'employer-b@demo.vta.local',
      contactPhone: '9900000302',
    });
    // employerB is verified, so changing the GSTIN is refused...
    const b = await c.employerAdminB!.get('/employer/company');
    expect(b.body.identityLocked).toBe(true);
    // ...while the pending company's same-name check flags against existing names.
    const dup = await c.employerAdminPending!.put('/employer/company', {
      legalName: 'Sunrise  two-wheeler service (demo)',
      sector: 'ev_service',
      city: 'Bengaluru',
      contactName: 'Meera Employer Pending',
      contactEmail: 'employer-pending@demo.vta.local',
      contactPhone: '9900000303',
    });
    expect(dup.body.possibleDuplicate).toBe(true);
    const admin = await c.secondAdmin!.get(`/admin/organisations/${ctx.ids.employerPending}/company`);
    expect(admin.body.possibleDuplicate).toMatchObject({ id: ctx.ids.employerA });
  });

  it('a verified company’s registered name and GSTIN are locked', async () => {
    const res = await c.employerAdminA!.put('/employer/company', {
      legalName: 'Renamed Ltd',
      sector: 'service_workshop',
      city: 'Bengaluru',
      contactName: 'Rahul Employer A',
      contactEmail: 'employer-a@demo.vta.local',
      contactPhone: '9900000301',
    });
    expect(res.body.error.fields.legalName).toBe('Verified by AutoTalent Grid');
  });

  it('each employer has one login: the team pages are gone and a second employer login is refused', async () => {
    expect((await c.employerAdminA!.get('/employer/team')).status).toBe(404);
    expect((await c.employerAdminA!.post('/employer/team', { name: 'Sanjay Recruiter', email: 'sanjay@example.invalid' })).status).toBe(404);
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const second = await sa.post('/admin/role-assignments', { userId: ctx.ids.pendingUser, role: 'employer_admin', organisationId: ctx.ids.employerA });
    expect(second.status).toBe(400);
    expect(second.body.error.message).toMatch(/This organisation already has its login/);
    // Employers cannot hand out roles themselves either.
    expect((await c.employerAdminA!.post('/admin/role-assignments', { userId: ctx.ids.pendingUser, role: 'employer_admin', organisationId: ctx.ids.employerA })).status).toBe(403);
  });
});

describe('EM-03 / AD-09 jobs and moderation', () => {
  let jobId = '';
  it('the employer posts a job; it goes to AutoTalent Grid, which publishes it', async () => {
    const created = await c.employerAdminA!.post('/employer/jobs', newJob());
    expect(created.body.status).toBe('draft');
    jobId = created.body.id;
    expect((await c.employerAdminA!.post(`/employer/jobs/${jobId}/submit`)).body.status).toBe('pending_review');
    // Not visible to learners yet.
    expect((await c.learner!.get(`/jobs/${jobId}`)).status).toBe(404);

    const queue = await c.secondAdmin!.get('/admin/jobs?status=pending_review');
    expect(queue.body.items.map((j: { id: string }) => j.id)).toContain(jobId);
    expect((await c.secondAdmin!.post(`/admin/jobs/${jobId}/moderate`, { action: 'reject' })).body.error.fields.reason).toBe('Give a reason');
    expect((await c.secondAdmin!.post(`/admin/jobs/${jobId}/moderate`, { action: 'publish' })).body.status).toBe('published');
    expect((await c.learner!.get(`/jobs/${jobId}`)).status).toBe(200);
  });

  it('validates the job: salary range, closing date, required fields', async () => {
    const bad = await c.employerAdminA!.post('/employer/jobs', newJob({ salaryMin: 30000, salaryMax: 20000, closingDate: '2026-01-01', description: 'short' }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['salaryMax', 'description']));
    const past = await c.employerAdminA!.post('/employer/jobs', newJob({ closingDate: '2026-10-01' }));
    expect(past.body.error.fields.closingDate).toBe('Choose today or later');
  });

  it('editing a published job sends it back to AutoTalent Grid; AutoTalent Grid can pause or close with a reason', async () => {
    const edited = await c.employerAdminA!.put(`/employer/jobs/${jobId}`, newJob({ openings: 4 }));
    expect(edited.body.status).toBe('pending_review');
    await c.secondAdmin!.post(`/admin/jobs/${jobId}/moderate`, { action: 'publish' });
    expect((await c.secondAdmin!.post(`/admin/jobs/${jobId}/moderate`, { action: 'pause', reason: 'Salary needs checking' })).body.status).toBe('paused');
    expect((await c.learner!.get(`/jobs/${jobId}`)).status).toBe(404);
    const audit = await ctx.db.selectFrom('audit_events').select('after').where('action', '=', 'job.moderation.pause').executeTakeFirstOrThrow();
    expect(audit.after).toMatchObject({ reason: 'Salary needs checking' });
    expect((await c.employerAdminA!.post(`/employer/jobs/${jobId}/resume`)).body.status).toBe('published');
  });

  it('another employer cannot see, edit or change A’s jobs (not found)', async () => {
    expect((await c.employerAdminB!.get(`/employer/jobs/${jobId}`)).status).toBe(404);
    expect((await c.employerAdminB!.put(`/employer/jobs/${jobId}`, newJob())).status).toBe(404);
    expect((await c.employerAdminB!.post(`/employer/jobs/${jobId}/close`)).status).toBe(404);
    expect((await c.employerAdminB!.get(`/employer/jobs/${jobId}/applications`)).status).toBe(404);
    expect((await c.employerAdminB!.get('/employer/jobs')).body.items.map((j: { id: string }) => j.id)).not.toContain(jobId);
  });

  it('only AutoTalent Grid moderates; employers and partners cannot', async () => {
    expect((await c.employerAdminA!.post(`/admin/jobs/${jobId}/moderate`, { action: 'close', reason: 'x' })).status).toBe(403);
    expect((await c.partnerAdminA!.get('/admin/jobs')).status).toBe(403);
  });
});

describe('EE-07 to EE-09 learners find jobs and apply', () => {
  it('learners see only published, open jobs from verified employers, with filters', async () => {
    const res = await c.ravi!.get('/jobs?skillArea=2W');
    expect(res.status).toBe(200);
    const titles = res.body.items.map((j: { title: string }) => j.title);
    expect(titles).toContain('Two-wheeler service technician');
    expect(titles).not.toContain('Senior two-wheeler technician'); // a draft
    expect((await c.ravi!.get('/jobs')).body.items.map((j: { title: string }) => j.title)).not.toContain('EV service technician'); // waiting for review
    expect((await c.ravi!.get('/jobs?city=Hubballi')).body.items).toHaveLength(0);
  });

  it('the job page shows exactly what applying would share', async () => {
    const j = await c.ravi!.get(`/jobs/${ctx.ids.job2wA}`);
    expect(j.body).toMatchObject({ employer: 'Sunrise Two-Wheeler Service (demo)', salaryMin: 16000, myApplicationId: null });
    expect(j.body.share.fields).toContain('Mobile number');
    expect(j.body.share.certificates.map((x: { course: string }) => x.course)).toContain('2W Service Technician');
  });

  it('applying needs the sharing confirmation; it stores a snapshot and blocks a second active application', async () => {
    expect((await c.ravi!.post(`/jobs/${ctx.ids.job2wA}/apply`, {})).body.error.fields.shareProfile).toMatch(/Confirm/);
    const ok = await c.ravi!.post(`/jobs/${ctx.ids.job2wA}/apply`, { shareProfile: true, note: 'Available from December' });
    expect(ok.status).toBe(201);
    const again = await c.ravi!.post(`/jobs/${ctx.ids.job2wA}/apply`, { shareProfile: true });
    expect(again.status).toBe(409);
    const row = await ctx.db.selectFrom('job_applications').select(['consent_snapshot']).where('id', '=', ok.body.id).executeTakeFirstOrThrow();
    expect(row.consent_snapshot).toMatchObject({ employer: 'Sunrise Two-Wheeler Service (demo)', noticeVersion: NOTICE_VERSION });
    expect((await c.ravi!.get('/me/applications')).body.items[0]).toMatchObject({ status: 'applied', job: { title: 'Two-wheeler service technician' } });
  });

  it('a learner cannot see another learner’s application', async () => {
    const mine = (await c.ravi!.get('/me/applications')).body.items[0].id;
    expect((await c.learner!.get(`/me/applications/${mine}`)).status).toBe(404);
    expect((await c.learner!.post(`/me/applications/${mine}/withdraw`)).status).toBe(404);
  });
});

describe('EM-05 to EM-08, EM-10 the employer’s pipeline', () => {
  let appId = '';
  it('the employer sees applicants; opening one shows contact details and is logged', async () => {
    const list = await c.employerAdminA!.get(`/employer/jobs/${ctx.ids.job2wA}/applications`);
    const ravi = list.body.items.find((a: { name: string }) => a.name === 'Ravi Kumar');
    expect(ravi).toMatchObject({ status: 'applied', vtaCertificates: 1 });
    appId = ravi.id;
    const detail = await c.employerAdminA!.get(`/employer/applications/${appId}`);
    expect(detail.body.candidate).toMatchObject({ name: 'Ravi Kumar', phone: RAVI, contactShared: true });
    expect(detail.body.nextMoves).toEqual(['shortlisted', 'rejected']);
    const logged = await ctx.db.selectFrom('audit_events').select(['actor_id', 'entity_id']).where('action', '=', 'application.contact_viewed').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(logged).toEqual({ actor_id: ctx.ids.employerAdminA, entity_id: ctx.ids.cand1 });
    // Another employer: not found.
    expect((await c.employerAdminB!.get(`/employer/applications/${appId}`)).status).toBe(404);
    expect((await c.employerAdminB!.post(`/employer/applications/${appId}/move`, { to: 'rejected' })).status).toBe(404);
  });

  it('moves follow the pipeline with a timestamped timeline; jumping ahead is refused', async () => {
    expect((await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'joined', joiningDate: '2026-10-20' })).status).toBe(400);
    expect((await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'shortlisted' })).body.status).toBe('shortlisted');
  });

  it('scheduling an interview moves it to interview; notes stay with the employer', async () => {
    const res = await c.employerAdminA!.post(`/employer/applications/${appId}/interviews`, {
      scheduledAt: '2026-10-28T10:30:00+05:30',
      mode: 'in_person',
      location: 'Peenya workshop',
      internalNotes: 'Strong on brakes; check electrical basics',
    });
    expect(res.status).toBe(201);
    const emp = await c.employerAdminA!.get(`/employer/applications/${appId}`);
    expect(emp.body.status).toBe('interview');
    expect(emp.body.interviews[0]).toMatchObject({ mode: 'in_person', internalNotes: 'Strong on brakes; check electrical basics' });
    expect(emp.body.timeline.map((e: { to: string }) => e.to)).toEqual(['applied', 'shortlisted', 'interview']);

    const learner = await c.ravi!.get(`/me/applications/${appId}`);
    expect(learner.body.status).toBe('interview');
    expect(learner.body.interviews[0]).toMatchObject({ mode: 'in_person', location: 'Peenya workshop' });
    expect(JSON.stringify(learner.body)).not.toMatch(/Strong on brakes|internalNotes|outcome/);
    // Interview notes never go into the audit trail either.
    const audits = await ctx.db.selectFrom('audit_events').select(['after']).where('entity_id', '=', appId).execute();
    expect(JSON.stringify(audits)).not.toMatch(/Strong on brakes/);
  });

  it('offer, then joined with a joining date; AutoTalent Grid verifies the outcome', async () => {
    await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'offer' });
    expect((await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'joined' })).body.error.fields.joiningDate).toBe('Enter the joining date');
    expect((await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'joined', joiningDate: '2026-11-30' })).body.error.fields.joiningDate).toBe('Not in the future');
    expect((await c.employerAdminA!.post(`/employer/applications/${appId}/move`, { to: 'joined', joiningDate: '2026-10-26' })).body.status).toBe('joined');

    const outcomes = await c.secondAdmin!.get('/admin/hiring-outcomes?verification=unverified');
    expect(outcomes.body.items.find((o: { id: string }) => o.id === appId)).toMatchObject({ status: 'joined', joiningDate: '2026-10-26', employer: 'Sunrise Two-Wheeler Service (demo)' });
    expect((await c.secondAdmin!.post(`/admin/applications/${appId}/outcome-review`, { decision: 'flagged' })).status).toBe(400);
    expect((await c.secondAdmin!.post(`/admin/applications/${appId}/outcome-review`, { decision: 'verified', note: 'Confirmed by phone with employer and candidate' })).status).toBe(200);
    const dash = await c.secondAdmin!.get('/admin/dashboard');
    expect(dash.body.hiring).toMatchObject({ joinedRecorded: 1, joinedVerified: 1 });
    expect((await c.employerAdminA!.post(`/admin/applications/${appId}/outcome-review`, { decision: 'verified' })).status).toBe(403);
  });

  it('the employer dashboard counts applicants, shortlists, interviews and joinings per job', async () => {
    const d = await c.employerAdminA!.get('/employer/dashboard');
    const j = d.body.jobs.find((x: { id: string }) => x.id === ctx.ids.job2wA);
    expect(j).toMatchObject({ applicants: 2, shortlisted: 1, interviews: 1, joined: 1 });
    expect(d.body.totals.joined).toBe(1);
  });

  it('a withdrawn application hides the person’s contact details and documents from the employer', async () => {
    const anithaApp = ctx.ids.applicationAnitha!;
    expect((await c.anitha!.post(`/me/applications/${anithaApp}/withdraw`)).status).toBe(200);
    const view = await c.employerAdminA!.get(`/employer/applications/${anithaApp}`);
    expect(view.body.candidate).toMatchObject({ name: 'Withdrawn applicant', phone: null, email: null, contactShared: false });
    expect((await c.employerAdminA!.post(`/employer/applications/${anithaApp}/move`, { to: 'interview' })).body.error.message).toMatch(/withdrew/);
  });
});

describe('EM-04 / EM-05 candidate search', () => {
  it('only verified candidates who opted in appear, with a masked name and no contact details', async () => {
    const res = await c.employerAdminA!.get('/employer/candidates?skillArea=2W');
    expect(res.status).toBe(200);
    // Venkatesh opted in; Ravi has not.
    const names = res.body.items.map((x: { name: string }) => x.name);
    expect(names).toContain('Venkatesh L.');
    expect(names).not.toContain('Ravi K.');
    expect(JSON.stringify(res.body)).not.toMatch(/\+91|@|Learner|dateOfBirth/);
  });

  it('filters by certificate and experience; turning search off removes the person at once', async () => {
    expect((await c.employerAdminA!.get('/employer/candidates?hasCertificate=yes')).body.items.map((x: { name: string }) => x.name)).not.toContain('Venkatesh L.');
    await c.learner!.post('/me/consents', { purpose: 'profile_searchable', granted: false });
    expect((await c.employerAdminA!.get('/employer/candidates')).body.items.map((x: { name: string }) => x.name)).not.toContain('Venkatesh L.');
    await c.learner!.post('/me/consents', { purpose: 'profile_searchable', granted: true });
  });

  it('opening a profile is logged; inviting to apply shows up for the learner', async () => {
    const view = await c.employerAdminA!.get(`/employer/candidates/${ctx.ids.learner}`);
    // Employer A is on a paid plan: contact details and the full name are shown, and that is logged too.
    expect(view.body).toMatchObject({ name: 'Venkatesh Learner', phone: expect.stringMatching(/^\+91\d{10}$/), contactNeedsUpgrade: false });
    expect(await ctx.db.selectFrom('audit_events').select('id').where('action', '=', 'candidate.contact_viewed').executeTakeFirst()).toBeTruthy();
    const log = await ctx.db.selectFrom('audit_events').select('entity_id').where('action', '=', 'candidate.profile_viewed').executeTakeFirstOrThrow();
    expect(log.entity_id).toBe(ctx.ids.learner);

    expect((await c.employerAdminA!.post(`/employer/candidates/${ctx.ids.learner}/invite`, { jobId: ctx.ids.jobEvB })).status).toBe(400); // not their job
    expect((await c.employerAdminA!.post(`/employer/candidates/${ctx.ids.learner}/invite`, { jobId: ctx.ids.job2wA, message: 'We liked your profile' })).status).toBe(201);
    expect((await c.employerAdminA!.post(`/employer/candidates/${ctx.ids.learner}/invite`, { jobId: ctx.ids.job2wA })).status).toBe(409);
    const jobs = await c.learner!.get('/jobs');
    expect(jobs.body.invitations[0]).toMatchObject({ title: 'Two-wheeler service technician', message: 'We liked your profile' });
  });

  it('someone who did not opt in cannot be opened or invited, even by id', async () => {
    expect((await c.employerAdminA!.get(`/employer/candidates/${ctx.ids.cand1}`)).status).toBe(404);
    expect((await c.employerAdminA!.post(`/employer/candidates/${ctx.ids.cand1}/invite`, { jobId: ctx.ids.job2wA })).status).toBe(404);
  });

  it('learners, partners and trainers cannot search candidates', async () => {
    expect((await c.learner!.get('/employer/candidates')).status).toBe(403);
    expect((await c.partnerAdminA!.get('/employer/candidates')).status).toBe(403);
  });
});
