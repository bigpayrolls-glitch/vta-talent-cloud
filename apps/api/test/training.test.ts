import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, setup, type Client, type Ctx } from './helpers.js';

/** Phase 2 acceptance criteria T-01 to T-05 (files are in files.test.ts, isolation in isolation2.test.ts). */
let ctx: Ctx;
let ops: Client;
beforeAll(async () => {
  ctx = await setup();
  ops = await loginEmail(ctx, EMAIL.secondAdmin);
});
afterAll(() => ctx.close());

const course = (over: Record<string, unknown> = {}) => ({
  title: 'Two-Wheeler EFI Specialist',
  code: 'efi-01',
  skillArea: '2W',
  level: 'advanced',
  deliveryMode: 'classroom',
  durationValue: 6,
  durationUnit: 'weeks',
  attendanceThresholdPct: 80,
  passMarkPct: 65,
  criteria: [
    { label: 'Fuel injection diagnosis', maxScore: 50, required: true },
    { label: 'Sensor testing', maxScore: 50 },
  ],
  ...over,
});

describe('T-01 courses and criteria', () => {
  it('creates a course with criteria, a pass rule and an attendance threshold', async () => {
    const res = await ops.post('/admin/courses', course());
    expect(res.status).toBe(201);
    const c = await ops.get(`/courses/${res.body.id}`);
    expect(c.body).toMatchObject({ code: 'EFI-01', title: 'Two-Wheeler EFI Specialist', attendanceThresholdPct: 80, passMarkPct: 65, status: 'active', criteriaLocked: false });
    expect(c.body.criteria.map((x: { label: string; required: boolean }) => [x.label, x.required])).toEqual([
      ['Fuel injection diagnosis', true],
      ['Sensor testing', false],
    ]);
  });

  it('requires at least one criterion and a valid threshold', async () => {
    const res = await ops.post('/admin/courses', course({ code: 'X-1', criteria: [], attendanceThresholdPct: 120 }));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(['criteria', 'attendanceThresholdPct']));
  });

  it('refuses a duplicate course code', async () => {
    const res = await ops.post('/admin/courses', course({ code: '2W-ST-01' }));
    expect(res.status).toBe(409);
    expect(res.body.error.fields.code).toBe('Already in use');
  });

  it('locks criteria and pass rules once a batch of the course has started', async () => {
    // The seeded 2W course has an active batch.
    const id = ctx.ids.course2w!;
    expect((await ops.get(`/courses/${id}`)).body.criteriaLocked).toBe(true);
    const put = await ops.put(`/admin/courses/${id}/criteria`, { criteria: [{ label: 'Only one', maxScore: 10 }] });
    expect(put.status).toBe(400);
    expect((await ops.patch(`/admin/courses/${id}`, { passMarkPct: 50 })).status).toBe(400);
    // Description can still change.
    expect((await ops.patch(`/admin/courses/${id}`, { description: 'Updated outline' })).status).toBe(200);
    // A course with only planned batches can still change its criteria.
    const ok = await ops.put(`/admin/courses/${ctx.ids.course4w}/criteria`, { criteria: [{ label: 'Diagnostics', maxScore: 100, required: true }] });
    expect(ok.status).toBe(200);
    expect(ok.body.criteria).toHaveLength(1);
  });

  it('an inactive course cannot get new batches', async () => {
    const res = await ops.post('/admin/courses', course({ code: 'OLD-1', title: 'Retired course' }));
    await ops.post(`/admin/courses/${res.body.id}/deactivate`);
    const b = await ops.post('/admin/batches', {
      name: 'Should fail', courseId: res.body.id, centreId: ctx.ids.centreVta, trainerId: ctx.ids.trainerVta, startDate: '2026-12-01', endDate: '2027-01-01', capacity: 10,
    });
    expect(b.status).toBe(400);
    expect(b.body.error.fields.courseId).toMatch(/inactive/);
  });

  it('filters the catalogue by skill area and search text on the server', async () => {
    const ev = await ops.get('/courses?skillArea=EV');
    expect(ev.body.items.map((c: { title: string }) => c.title)).toEqual(['EV Technician']);
    expect((await ops.get('/courses?q=4w-st')).body.items[0].code).toBe('4W-ST-01');
  });
});

describe('T-02 trainers and centres', () => {
  it('adds a trainer at a partner centre; the organisation comes from the centre', async () => {
    const res = await ops.post('/admin/trainers', { name: 'Gopal Trainer', phone: '9900000401', centreId: ctx.ids.centrePartnerA, specialisations: ['2W'] });
    expect(res.status).toBe(201);
    const t = await ops.get(`/trainers/${res.body.id}`);
    expect(t.body.verificationStatus).toBe('pending');
    expect(t.body.centres.map((c: { name: string; organisationName: string }) => [c.name, c.organisationName])).toEqual([['Skill Bridge Peenya Centre', 'Skill Bridge Foundation (demo)']]);
  });

  it('adds a trainer at an AutoTalent Grid-run centre with no partner organisation', async () => {
    const res = await ops.post('/admin/trainers', { name: 'Lata AutoTalent Grid Trainer', phone: '9900000402', centreId: ctx.ids.centreVta });
    expect(res.status).toBe(201);
    const ra = await ctx.db.selectFrom('role_assignments').select(['organisation_id']).where('user_id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(ra.organisation_id).toBeNull();
  });

  it('assigns a trainer to a second centre and verifies them', async () => {
    const id = ctx.ids.trainerPending!;
    expect((await ops.post(`/admin/trainers/${id}/centres`, { centreId: ctx.ids.centreVta })).status).toBe(201);
    expect((await ops.post(`/admin/trainers/${id}/centres`, { centreId: ctx.ids.centreVta })).status).toBe(409);
    expect((await ops.post(`/admin/trainers/${id}/reject`, {})).status).toBe(400); // reason required
    expect((await ops.post(`/admin/trainers/${id}/verify`)).body.verificationStatus).toBe('verified');
    const t = await ops.get(`/trainers/${id}`);
    expect(t.body.centres).toHaveLength(2);
  });

  it('a phone number already registered cannot be added again', async () => {
    const res = await ops.post('/admin/trainers', { name: 'Copy', phone: '+919900000101', centreId: ctx.ids.centreVta });
    expect(res.status).toBe(409);
    expect(res.body.error.fields.phone).toBe('Already registered');
  });

  it('giving the trainer role through Add role also creates a trainer profile', async () => {
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    expect((await sa.post('/admin/role-assignments', { userId: ctx.ids.pendingUser, role: 'trainer', centreId: ctx.ids.centrePartnerB })).status).toBe(201);
    const tp = await ctx.db.selectFrom('trainer_profiles').select('verification_status').where('user_id', '=', ctx.ids.pendingUser!).executeTakeFirst();
    expect(tp?.verification_status).toBe('pending');
  });

  it('the trainer role can be given with no centre, for an independent trainer', async () => {
    const sa = await loginEmail(ctx, EMAIL.superAdmin);
    const res = await sa.post('/admin/role-assignments', { userId: ctx.ids.employerAdminPending, role: 'trainer' });
    expect(res.status).toBe(201);
    const ra = await ctx.db.selectFrom('role_assignments').select(['organisation_id', 'centre_id']).where('id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(ra).toEqual({ organisation_id: null, centre_id: null });
  });
});

describe('T-03 candidates: create, duplicates, approval', () => {
  const base = { name: 'Harish Bhat', phone: '9900000501', dateOfBirth: '2001-05-05', city: 'Udupi', skillAreas: ['2W'], experienceMonths: 12 };

  it('creates an invited candidate with a unique candidate code and the learner role', async () => {
    const res = await ops.post('/admin/candidates', base);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^ATG\d{7}$/);
    expect(res.body.possibleDuplicate).toBe(false);
    const c = await ops.get(`/admin/candidates/${res.body.id}`);
    expect(c.body).toMatchObject({ name: 'Harish Bhat', phone: '+919900000501', verificationStatus: 'pending', userStatus: 'invited', source: 'admin', searchable: false });
    const role = await ctx.db.selectFrom('role_assignments').select('role').where('user_id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(role.role).toBe('learner');
  });

  it('blocks under-18s during the pilot (decision D4)', async () => {
    const d = new Date();
    const seventeen = `${d.getFullYear() - 17}-01-01`;
    const res = await ops.post('/admin/candidates', { ...base, phone: '9900000502', dateOfBirth: seventeen });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.dateOfBirth).toMatch(/18 or older/);
  });

  it('refuses a phone number that is already registered', async () => {
    const res = await ops.post('/admin/candidates', { ...base, name: 'Other Person' });
    expect(res.status).toBe(409);
    expect(res.body.error.fields.phone).toBe('Already registered');
  });

  it('flags the same name and date of birth as a possible duplicate, ignoring case and spaces', async () => {
    const res = await ops.post('/admin/candidates', { ...base, name: '  harish   BHAT ', phone: '9900000503' });
    expect(res.status).toBe(201);
    expect(res.body.possibleDuplicate).toBe(true);
    const c = await ops.get(`/admin/candidates/${res.body.id}`);
    expect(c.body.possibleDuplicate.name).toBe('Harish Bhat');
    // Cannot be verified until reviewed
    expect((await ops.post(`/admin/candidates/${res.body.id}/verify`)).status).toBe(400);
    expect((await ops.post(`/admin/candidates/${res.body.id}/dismiss-duplicate`)).status).toBe(200);
    expect((await ops.post(`/admin/candidates/${res.body.id}/verify`)).body.verificationStatus).toBe('verified');
  });

  it('records approval decisions with reasons and keeps history in the audit log', async () => {
    const id = ctx.ids.cand7!;
    expect((await ops.post(`/admin/candidates/${id}/request-correction`, {})).status).toBe(400);
    expect((await ops.post(`/admin/candidates/${id}/request-correction`, { reason: 'Date of birth looks wrong' })).body.verificationStatus).toBe('needs_correction');
    const c = await ops.get(`/admin/candidates/${id}`);
    expect(c.body.verificationReason).toBe('Date of birth looks wrong');
    expect((await ops.post(`/admin/candidates/${id}/verify`)).body.verificationStatus).toBe('verified');
    const history = await ctx.db.selectFrom('audit_events').select('action').where('entity_id', '=', id).orderBy('created_at').execute();
    expect(history.map((h) => h.action)).toEqual(['candidate.needs_correction', 'candidate.verified']);
  });

  it('edits are saved with before and after values; a name change re-checks duplicates', async () => {
    const id = ctx.ids.cand3!;
    const res = await ops.patch(`/admin/candidates/${id}`, { city: 'Bengaluru', name: 'Ravi Kumar', dateOfBirth: '2002-08-01' });
    expect(res.status).toBe(200);
    expect(res.body.possibleDuplicate).toBe(true);
    const ev = await ctx.db.selectFrom('audit_events').select(['before', 'after']).where('entity_id', '=', id).where('action', '=', 'candidate.updated').executeTakeFirstOrThrow();
    expect(ev.before).toMatchObject({ city: 'Tumakuru', name: 'Mohammed Shafi' });
    expect(ev.after).toMatchObject({ city: 'Bengaluru', name: 'Ravi Kumar' });
  });

  it('searches and filters candidates on the server (T-05)', async () => {
    const byCode = await ops.get('/admin/candidates?q=ATG2600002');
    expect(byCode.body.items.map((c: { name: string }) => c.name)).toEqual(['Ravi Kumar']);
    const byPhone = await ops.get('/admin/candidates?q=00000215');
    expect(byPhone.body.items[0].name).toBe('Naveen Shetty');
    const mysuru = await ops.get('/admin/candidates?city=mysuru');
    expect(mysuru.body.items.every((c: { city: string }) => c.city === 'Mysuru')).toBe(true);
    const ev = await ops.get('/admin/candidates?skillArea=EV');
    expect(ev.body.items.every((c: { skillAreas: string[] }) => c.skillAreas.includes('EV'))).toBe(true);
    const dups = await ops.get('/admin/candidates?duplicates=true');
    expect(dups.body.items.length).toBeGreaterThan(0);
    expect(dups.body.items.every((c: { possibleDuplicate: boolean }) => c.possibleDuplicate)).toBe(true);
    const page = await ops.get('/admin/candidates?pageSize=3');
    expect(page.body.items).toHaveLength(3);
    expect(page.body.total).toBeGreaterThan(3);
  });
});

describe('T-03 CSV import', () => {
  const csv = [
    'Name,Phone,Date of birth,City,Skill areas,Experience months,Email',
    'Sunil Hegde,9900000601,1998-02-14,Mangaluru,2W;EV,24,',
    '"Shetty, Prakash",99000 00602,2000-07-07,Udupi,4W,0,prakash@example.com',
    'Too Young,9900000603,2015-01-01,Mysuru,2W,0,',
    'Bad Phone,12345,2000-01-01,Mysuru,2W,0,',
    'Repeat Number,9900000601,2000-01-01,Mysuru,2W,0,',
    'Taken Number,+919900000211,2000-01-01,Mysuru,2W,0,',
    'Anitha Gowda,9900000604,2001-01-15,Bengaluru,2W,0,',
  ].join('\r\n');

  it('checks every row first without importing anything', async () => {
    const before = await ctx.db.selectFrom('candidate_profiles').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const res = await ops.post('/admin/candidates/import', { csv, commit: false });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 7, ready: 2, possibleDuplicates: 1, errors: 4 });
    const status = Object.fromEntries(res.body.rows.map((r: { row: number; status: string }) => [r.row, r.status]));
    expect(status).toEqual({ 2: 'ready', 3: 'ready', 4: 'error', 5: 'error', 6: 'error', 7: 'error', 8: 'possible_duplicate' });
    const messages = Object.fromEntries(res.body.rows.map((r: { row: number; messages: string[] }) => [r.row, r.messages.join(' | ')]));
    expect(messages[4]).toMatch(/18 or older/);
    expect(messages[5]).toMatch(/10-digit/);
    expect(messages[6]).toMatch(/Same number as row 2/);
    expect(messages[7]).toMatch(/Already registered/);
    const after = await ctx.db.selectFrom('candidate_profiles').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it('imports only valid rows, flags the possible duplicate, and audits the import', async () => {
    const res = await ops.post('/admin/candidates/import', { csv, commit: true });
    expect(res.body.imported).toBe(3);
    const shetty = await ops.get('/admin/candidates?q=Shetty, Prakash');
    expect(shetty.body.items[0]).toMatchObject({ name: 'Shetty, Prakash', phone: '+919900000602', city: 'Udupi', skillAreas: ['4W'] });
    const dup = await ops.get('/admin/candidates?q=9900000604');
    expect(dup.body.items[0].possibleDuplicate).toBe(true);
    const audit = await ctx.db.selectFrom('audit_events').select(['after']).where('action', '=', 'candidate.import_completed').executeTakeFirstOrThrow();
    expect(audit.after).toMatchObject({ imported: 3, errors: 4 });
    // Running the same file again imports nothing new: every number is now registered.
    const again = await ops.post('/admin/candidates/import', { csv, commit: false });
    expect(again.body.summary.ready).toBe(0);
  });

  it('explains missing columns and empty files', async () => {
    const missing = await ops.post('/admin/candidates/import', { csv: 'name,phone\nA,9900000699' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/date_of_birth, city/);
    const empty = await ops.post('/admin/candidates/import', { csv: 'name,phone,date_of_birth,city\n' });
    expect(empty.body.error.message).toMatch(/no candidate rows/);
  });
});

describe('T-04 batches and enrolment', () => {
  let batchId: string;

  it('creates a batch with course, centre, verified trainer at that centre, dates and capacity', async () => {
    const bad = await ops.post('/admin/batches', {
      name: 'Pending trainer', courseId: ctx.ids.course2w, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2026-12-10', endDate: '2026-12-01', capacity: 3,
    });
    expect(bad.body.error.fields.endDate).toBeDefined();
    const wrongCentre = await ops.post('/admin/batches', {
      name: 'Wrong centre', courseId: ctx.ids.course2w, centreId: ctx.ids.centreVta, trainerId: ctx.ids.trainerA, startDate: '2026-12-01', endDate: '2027-02-01', capacity: 3,
    });
    expect(wrongCentre.body.error.fields.trainerId).toMatch(/Not a trainer at this centre/);
    const res = await ops.post('/admin/batches', {
      name: '2W Peenya December 2026', courseId: ctx.ids.course2w, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2026-12-01', endDate: '2027-02-01', capacity: 3,
    });
    expect(res.status).toBe(201);
    batchId = res.body.id;
    const b = await ops.get(`/batches/${batchId}`);
    expect(b.body).toMatchObject({ status: 'planned', capacity: 3, enrolled: 0, canManage: true, course: { title: '2W Service Technician' }, trainer: { name: 'Prakash Trainer' } });
  });

  it('refuses an unverified trainer', async () => {
    const t = await ops.post('/admin/trainers', { name: 'Unverified Uma', phone: '9900000403', centreId: ctx.ids.centreVta });
    const res = await ops.post('/admin/batches', {
      name: 'Unverified', courseId: ctx.ids.course4w, centreId: ctx.ids.centreVta, trainerId: t.body.id, startDate: '2026-12-01', endDate: '2027-02-01', capacity: 5,
    });
    expect(res.body.error.fields.trainerId).toMatch(/not verified/);
  });

  it('enrols candidates and blocks duplicates and rejected profiles, all or nothing', async () => {
    const ok = await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand1, ctx.ids.cand2] });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ enrolled: 2, enrolledTotal: 2, capacity: 3 });

    const again = await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand1] });
    expect(again.status).toBe(400);
    expect(again.body.error.fields[ctx.ids.cand1!]).toMatch(/already enrolled/);

    await ops.post(`/admin/candidates/${ctx.ids.cand8}/reject`, { reason: 'Duplicate of an existing profile' });
    const mixed = await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand4, ctx.ids.cand8] });
    expect(mixed.status).toBe(400);
    expect(mixed.body.error.fields[ctx.ids.cand8!]).toMatch(/rejected/);
    // Nobody was added, including the valid one.
    const roster = await ops.get(`/batches/${batchId}/roster`);
    expect(roster.body.items).toHaveLength(2);
  });

  it('a profile flagged as a possible duplicate cannot be enrolled until reviewed', async () => {
    const res = await ops.post(`/admin/batches/${ctx.ids.batchB}/enrolments`, { candidateIds: [ctx.ids.cand3] });
    expect(res.status).toBe(400);
    expect(res.body.error.fields[ctx.ids.cand3!]).toMatch(/possible duplicate/);
  });

  it('enforces capacity', async () => {
    const res = await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand4, ctx.ids.cand5] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Only 1 place is left in this batch.');
    expect((await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand4] })).status).toBe(201);
    expect((await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand5] })).body.error.message).toBe('This batch is full.');
    expect((await ops.patch(`/admin/batches/${batchId}`, { capacity: 2 })).body.error.fields.capacity).toBe('At least 3');
  });

  it('withdraws with a reason, frees the place, and allows re-enrolment', async () => {
    const roster = await ops.get(`/batches/${batchId}/roster`);
    const e = roster.body.items.find((x: { candidateId: string }) => x.candidateId === ctx.ids.cand4);
    expect((await ops.post(`/admin/enrolments/${e.enrolmentId}/withdraw`, {})).status).toBe(400);
    expect((await ops.post(`/admin/enrolments/${e.enrolmentId}/withdraw`, { reason: 'Moved to another city' })).status).toBe(200);
    expect((await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand5] })).status).toBe(201);
    await ops.patch(`/admin/batches/${batchId}`, { capacity: 4 });
    expect((await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand4] })).status).toBe(201);
    const after = await ops.get(`/batches/${batchId}/roster`);
    expect(after.body.items.filter((x: { status: string }) => x.status === 'enrolled')).toHaveLength(4);
  });

  it('roster search by name or candidate code', async () => {
    const r = await ops.get(`/batches/${batchId}/roster?q=anitha`);
    expect(r.body.items.map((x: { name: string }) => x.name)).toEqual(['Anitha Gowda']);
    const code = r.body.items[0].code;
    expect((await ops.get(`/batches/${batchId}/roster?q=${code}`)).body.items).toHaveLength(1);
  });

  it('moves through planned → active → completed, and completed batches are frozen', async () => {
    expect((await ops.post(`/admin/batches/${batchId}/complete`)).status).toBe(400);
    expect((await ops.post(`/admin/batches/${batchId}/start`)).body.status).toBe('active');
    expect((await ops.post(`/admin/batches/${batchId}/complete`)).body.status).toBe('completed');
    expect((await ops.patch(`/admin/batches/${batchId}`, { name: 'Renamed' })).status).toBe(400);
    expect((await ops.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand6] })).status).toBe(400);
    expect((await ops.post(`/admin/batches/${batchId}/cancel`, { reason: 'Too late' })).status).toBe(400);
  });

  it('cancelling needs a reason', async () => {
    expect((await ops.post(`/admin/batches/${ctx.ids.batchVta}/cancel`, {})).status).toBe(400);
    const res = await ops.post(`/admin/batches/${ctx.ids.batchVta}/cancel`, { reason: 'Centre closed for renovation' });
    expect(res.body.status).toBe('cancelled');
    expect((await ops.get(`/batches/${ctx.ids.batchVta}`)).body.cancelReason).toBe('Centre closed for renovation');
  });

  it('candidate options list only people who can be enrolled, with minimal fields', async () => {
    const res = await ops.get(`/admin/batches/${ctx.ids.batchB}/candidate-options?q=Ravi`);
    const names = res.body.items.map((c: { name: string }) => c.name);
    expect(names).toContain('Ravi Kumar');
    // cand8 (rejected earlier) and cand3 (now a possible duplicate) are not offered
    const ids = res.body.items.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(ctx.ids.cand8);
    expect(ids).not.toContain(ctx.ids.cand3);
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['city', 'code', 'id', 'name', 'verificationStatus']);
    // Already enrolled in batch B → not offered
    const enrolled = await ops.get(`/admin/batches/${ctx.ids.batchB}/candidate-options?q=Naveen`);
    expect(enrolled.body.items).toEqual([]);
  });

  it('lists batches with server-side filters', async () => {
    const active = await ops.get('/batches?status=active');
    expect(active.body.items.every((b: { status: string }) => b.status === 'active')).toBe(true);
    const ev = await ops.get(`/batches?courseId=${ctx.ids.courseEv}`);
    expect(ev.body.items.map((b: { name: string }) => b.name)).toEqual(['EV Mysuru November 2026']);
    const search = await ops.get('/batches?q=peenya');
    expect(search.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('every change is in the audit log', async () => {
    const actions = (await ctx.db.selectFrom('audit_events').select('action').where('entity_type', '=', 'batch').execute()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['batch.created', 'batch.enrolled', 'enrolment.withdrawn', 'batch.active', 'batch.completed', 'batch.cancelled', 'batch.updated']));
  });
});

describe('dashboard shows training figures', () => {
  it('counts courses, batches, enrolments and items awaiting verification', async () => {
    const d = (await ops.get('/admin/dashboard')).body;
    expect(d.training.activeCourses).toBeGreaterThanOrEqual(3);
    expect(d.training.batchesActive).toBeGreaterThanOrEqual(1);
    expect(d.awaitingAction).toHaveProperty('candidatesPendingVerification');
    expect(d.awaitingAction).toHaveProperty('possibleDuplicates');
    expect(d.awaitingAction).toHaveProperty('trainersPendingVerification');
  });
});
