import { NOTICE_VERSION } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFromCookie, cookieFrom, EMAIL, loginEmail, loginPhone, nextIp, PHONE, setup, type Client, type Ctx } from './helpers.js';

/** Phase 5 acceptance criteria: EE-01 to EE-06, EE-10 and SH-05 (Learner portal). */
let ctx: Ctx;
const c: Record<string, Client> = {};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const RAVI = '+919900000211';
const ANITHA = '+919900000212';

beforeAll(async () => {
  ctx = await setup();
  c.learner = await loginPhone(ctx, PHONE.learner);
  c.ravi = await loginPhone(ctx, RAVI);
  c.secondAdmin = await loginEmail(ctx, EMAIL.secondAdmin);
  c.trainerA = await loginPhone(ctx, PHONE.trainerA);
});
afterAll(() => ctx.close());

async function requestCode(phone: string, purpose?: 'register' | 'login') {
  await ctx.db.deleteFrom('otp_challenges').where('phone', '=', phone).execute();
  ctx.mem.sentOtps.delete(phone);
  return ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone, ...(purpose ? { purpose } : {}) }, remoteAddress: nextIp() });
}
const registration = (phone: string, code: string, over: Record<string, unknown> = {}) => ({
  phone,
  code,
  name: 'Suresh Babu',
  dateOfBirth: '2001-05-05',
  city: 'Mandya',
  acceptPrivacy: true,
  acceptTerms: true,
  noticeVersion: NOTICE_VERSION,
  ...over,
});
const register = (body: unknown) => ctx.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body as object, remoteAddress: nextIp() });

describe('EE-01 self-registration', () => {
  const phone = '+919811112222';

  it('a new number gets a code; registering creates an active learner with a pending profile and the accepted consents', async () => {
    const r = await requestCode(phone, 'register');
    expect(r.json().message).toBe('A code has been sent to this number.');
    const code = ctx.mem.sentOtps.get(phone)!;
    expect(code).toMatch(/^\d{6}$/);

    const res = await register(registration(phone, code));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, existing: false });
    const me = await clientFromCookie(ctx.app, cookieFrom(res));
    const profile = (await me.get('/me/profile')).body;
    expect(profile).toMatchObject({ name: 'Suresh Babu', phone, city: 'Mandya', verificationStatus: 'pending', consentRequired: false, identityLocked: false, searchable: false });
    expect(profile.candidateCode).toMatch(/^ATG\d{7}$/);
    expect(profile.completeness.pct).toBeLessThan(50); // incomplete profiles are allowed (EE-01)

    const consents = (await me.get('/me/consents')).body;
    expect(consents.current.map((x: { purpose: string }) => x.purpose).sort()).toEqual(['privacy_notice', 'terms']);
    expect(consents.current.every((x: { noticeVersion: string }) => x.noticeVersion === NOTICE_VERSION)).toBe(true);
    const audit = await ctx.db.selectFrom('audit_events').select(['actor_id']).where('action', '=', 'candidate.self_registered').executeTakeFirstOrThrow();
    expect(audit.actor_id).toBe(profile.id);
    // It appears to VTA staff for verification, marked as self-registered.
    const staff = (await c.secondAdmin!.get(`/admin/candidates/${profile.id}`)).body;
    expect(staff).toMatchObject({ verificationStatus: 'pending' });
  });

  it('the notice and terms must be accepted, the person must be 18+, and the code must be right', async () => {
    await requestCode('+919811113333', 'register');
    const code = ctx.mem.sentOtps.get('+919811113333')!;
    expect((await register(registration('+919811113333', code, { acceptPrivacy: false }))).statusCode).toBe(400);
    expect((await register(registration('+919811113333', code, { noticeVersion: 'old' }))).statusCode).toBe(400);
    const young = await register(registration('+919811113333', code, { dateOfBirth: '2012-01-01' }));
    expect(young.json().error.fields.dateOfBirth).toMatch(/18 or older/);
    const wrong = await register(registration('+919811113333', code === '000000' ? '111111' : '000000'));
    expect(wrong.json().error.fields.code).toBe('Incorrect code');
  });

  it('a sign-in code cannot be used to register (codes are for one purpose)', async () => {
    await requestCode(PHONE.learner);
    const code = ctx.mem.sentOtps.get(PHONE.learner)!;
    expect((await register(registration(PHONE.learner, code))).json().error.fields.code).toBe('Code expired');
  });

  it('registering with a number that already has an account just signs that person in, changing nothing', async () => {
    const r = await requestCode(PHONE.learner, 'register');
    // Same answer as for a new number, so registration cannot be used to find out who is registered.
    expect(r.json().message).toBe('A code has been sent to this number.');
    const res = await register(registration(PHONE.learner, ctx.mem.sentOtps.get(PHONE.learner)!, { name: 'Someone Else' }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ existing: true });
    const me = await clientFromCookie(ctx.app, cookieFrom(res));
    expect((await me.get('/me/profile')).body.name).toBe('Venkatesh Learner');
  });

  it('sign-in codes still go only to registered numbers', async () => {
    const r = await requestCode('+919811114444');
    expect(r.json().message).toBe('If this number is registered, a code has been sent.');
    expect(ctx.mem.sentOtps.get('+919811114444')).toBeUndefined();
  });

  it('a possible duplicate (same name and date of birth) is flagged for AutoTalent Grid to review', async () => {
    await requestCode('+919811115555', 'register');
    const res = await register(registration('+919811115555', ctx.mem.sentOtps.get('+919811115555')!, { name: 'ravi  kumar', dateOfBirth: '2002-08-01' }));
    expect(res.statusCode).toBe(201);
    const me = await clientFromCookie(ctx.app, cookieFrom(res));
    const id = (await me.get('/me/profile')).body.id;
    const row = await ctx.db.selectFrom('candidate_profiles').select(['duplicate_of', 'source']).where('user_id', '=', id).executeTakeFirstOrThrow();
    expect(row).toEqual({ duplicate_of: ctx.ids.cand1, source: 'self' });
  });
});

describe('SH-05 consent before use', () => {
  it('a candidate added by staff must accept the current notice and terms on first sign-in', async () => {
    expect((await c.ravi!.get('/auth/me')).body.consentRequired).toBe(true);
    expect((await c.ravi!.get('/me/profile')).status).toBe(200); // the gate screen can greet them
    expect((await c.ravi!.get('/me/credentials')).status).toBe(403);
    expect((await c.ravi!.get('/me/learning')).body.error.message).toMatch(/Accept the privacy notice/);
    expect((await c.ravi!.post('/me/consents', { purpose: 'privacy_notice', granted: true, noticeVersion: 'old' })).status).toBe(400);

    await c.ravi!.post('/me/consents', { purpose: 'privacy_notice', granted: true, noticeVersion: NOTICE_VERSION });
    expect((await c.ravi!.get('/auth/me')).body.consentRequired).toBe(true); // terms still missing
    const done = await c.ravi!.post('/me/consents', { purpose: 'terms', granted: true, noticeVersion: NOTICE_VERSION });
    expect(done.body).toMatchObject({ ok: true, consentRequired: false });
    expect((await c.ravi!.get('/me/learning')).status).toBe(200);
  });

  it('the notice and terms cannot be "withdrawn" here (closing an account is a support request)', async () => {
    const res = await c.ravi!.post('/me/consents', { purpose: 'terms', granted: false, noticeVersion: NOTICE_VERSION });
    expect(res.status).toBe(400);
  });

  it('staff and other roles have no learner endpoints', async () => {
    expect((await c.secondAdmin!.get('/me/profile')).status).toBe(403);
    expect((await c.trainerA!.get('/me/learning')).status).toBe(403);
  });
});

describe('EE-10 profile sharing control', () => {
  it('turning the searchable profile on and off is recorded each time, never edited', async () => {
    await c.ravi!.post('/me/consents', { purpose: 'profile_searchable', granted: true });
    expect((await c.ravi!.get('/me/profile')).body.searchable).toBe(true);
    await c.ravi!.post('/me/consents', { purpose: 'profile_searchable', granted: false });
    expect((await c.ravi!.get('/me/profile')).body.searchable).toBe(false);
    // Saying the same again adds nothing.
    expect((await c.ravi!.post('/me/consents', { purpose: 'profile_searchable', granted: false })).body.changed).toBe(false);

    const history = (await c.ravi!.get('/me/consents')).body.history.filter((h: { purpose: string }) => h.purpose === 'profile_searchable');
    expect(history.map((h: { granted: boolean }) => h.granted)).toEqual([false, true]);
    const events = await ctx.db.selectFrom('audit_events').select('action').where('entity_id', '=', ctx.ids.cand1!).where('action', 'like', 'consent.%').execute();
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['consent.granted', 'consent.withdrawn']));
  });

  it('consent records cannot be changed or deleted, even directly in the database', async () => {
    await expect(ctx.db.updateTable('consent_events').set({ granted: true }).where('user_id', '=', ctx.ids.cand1!).execute()).rejects.toThrow(/append-only/);
    await expect(ctx.db.deleteFrom('consent_events').where('user_id', '=', ctx.ids.cand1!).execute()).rejects.toThrow(/append-only/);
  });
});

describe('EE-02 own profile', () => {
  it('saves part of a profile at a time and reports what is missing', async () => {
    const res = await c.learner!.patch('/me/profile', { skillAreas: ['2W', 'EV'], experienceMonths: 18, education: 'ITI Motor Mechanic', languages: ['Kannada', 'Hindi'] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skillAreas: ['2W', 'EV'], experienceMonths: 18, education: 'ITI Motor Mechanic' });
    expect(res.body.completeness.pct).toBe(100);
    const ev = await ctx.db.selectFrom('audit_events').select(['before', 'after']).where('action', '=', 'candidate.self_updated').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect((ev.after as Record<string, unknown>).experience_months).toBe(18);
  });

  it('name and date of birth are locked once AutoTalent Grid has verified them', async () => {
    const res = await c.learner!.patch('/me/profile', { name: 'Venky L' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.name).toMatch(/Ask your training centre/);
    // Re-sending the same value is fine.
    expect((await c.learner!.patch('/me/profile', { name: 'Venkatesh Learner', city: 'Bengaluru' })).status).toBe(200);
  });

  it('a profile sent back for correction goes back to AutoTalent Grid after the person fixes it', async () => {
    await ctx.db.updateTable('candidate_profiles').set({ verification_status: 'needs_correction', verification_reason: 'Date of birth does not match the ID' }).where('user_id', '=', ctx.ids.cand2!).execute();
    const anitha = await loginPhone(ctx, ANITHA);
    for (const purpose of ['privacy_notice', 'terms'] as const) await anitha.post('/me/consents', { purpose, granted: true, noticeVersion: NOTICE_VERSION });
    expect((await anitha.get('/me/profile')).body).toMatchObject({ verificationStatus: 'needs_correction', verificationReason: 'Date of birth does not match the ID', identityLocked: false });
    const fixed = await anitha.patch('/me/profile', { dateOfBirth: '2001-01-16' });
    expect(fixed.body).toMatchObject({ verificationStatus: 'pending', verificationReason: null, dateOfBirth: '2001-01-16' });
  });

  it('an email already used by another account is refused; an empty email clears it', async () => {
    expect((await c.learner!.patch('/me/profile', { email: EMAIL.secondAdmin })).body.error.fields.email).toBe('Already in use');
    expect((await c.learner!.patch('/me/profile', { email: 'venkatesh@example.invalid' })).body.email).toBe('venkatesh@example.invalid');
    expect((await c.learner!.patch('/me/profile', { email: '' })).body.email).toBeNull();
  });

  it('cannot change verification status, searchable or anything else through the profile', async () => {
    const res = await c.learner!.patch('/me/profile', { verificationStatus: 'verified', searchable: true, candidateCode: 'X' });
    expect(res.status).toBe(200);
    expect(res.body.candidateCode).not.toBe('X');
  });
});

describe('EE-03 evidence documents', () => {
  let docId = '';
  it('the learner uploads their own evidence and chooses who may see it', async () => {
    const res = await c.learner!.upload('/me/documents?kind=certificate&title=ITI%20certificate&fileName=iti.pdf&visibility=employers', PDF);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'ITI certificate', visibility: 'employers', verificationStatus: 'pending', uploadedBySelf: true, canDelete: true });
    docId = res.body.id;
    const changed = await c.learner!.patch(`/me/documents/${docId}`, { visibility: 'private' });
    expect(changed.body.visibility).toBe('private');
    const link = await c.learner!.get(`/me/documents/${docId}/link`);
    const file = await ctx.app.inject({ method: 'GET', url: link.body.url });
    expect(file.statusCode).toBe(200);
    // VTA staff see it on the candidate record for verification.
    expect((await c.secondAdmin!.get(`/files/${docId}/link`)).status).toBe(200);
  });

  it('files that are not PDF, JPG or PNG are refused', async () => {
    const res = await c.learner!.upload('/me/documents?kind=other&title=Notes&fileName=a.txt', Buffer.from('hello world, not a document'));
    expect(res.body.error.fields.file).toBe('File type not allowed');
  });

  it('another learner cannot see, change, link or delete it', async () => {
    expect((await c.ravi!.get('/me/documents')).body.items.find((d: { id: string }) => d.id === docId)).toBeUndefined();
    expect((await c.ravi!.patch(`/me/documents/${docId}`, { visibility: 'employers' })).status).toBe(404);
    expect((await c.ravi!.get(`/me/documents/${docId}/link`)).status).toBe(404);
    expect((await c.ravi!.del(`/me/documents/${docId}`)).status).toBe(404);
  });

  it('documents AutoTalent Grid added or verified cannot be deleted by the learner; their own can', async () => {
    const staffDoc = await c.secondAdmin!.upload(`/admin/candidates/${ctx.ids.learner}/documents?kind=certificate&title=Staff%20upload&fileName=s.pdf`, PDF);
    const list = (await c.learner!.get('/me/documents')).body.items;
    expect(list.find((d: { id: string }) => d.id === staffDoc.body.id)).toMatchObject({ uploadedBySelf: false, canDelete: false });
    expect((await c.learner!.del(`/me/documents/${staffDoc.body.id}`)).status).toBe(403);
    expect((await c.learner!.del(`/me/documents/${docId}`)).status).toBe(204);
    expect((await c.learner!.get('/me/documents')).body.items.find((d: { id: string }) => d.id === docId)).toBeUndefined();
  });
});

describe('EE-04 to EE-06 learning, results and certificates', () => {
  it('the learning dashboard shows each course with attendance and assessment state', async () => {
    const res = await c.ravi!.get('/me/learning');
    expect(res.status).toBe(200);
    const done = res.body.items.find((i: { batch: { name: string } }) => i.batch.name === '2W Peenya July 2026');
    expect(done).toMatchObject({ enrolmentStatus: 'completed', assessment: { state: 'released', outcome: 'pass' }, credentialId: ctx.ids.credentialRavi });
    const running = res.body.items.find((i: { batch: { name: string } }) => i.batch.name === '2W Peenya October 2026');
    expect(running).toMatchObject({ enrolmentStatus: 'enrolled', assessment: { state: 'not_assessed' } });
    expect(running.attendance.sessionsHeld).toBe(6);
    expect(running.attendance).toHaveProperty('thresholdPct');
  });

  it('a released result shows marks and trainer feedback, never reviewer details', async () => {
    const learning = (await c.ravi!.get('/me/learning')).body.items;
    const done = learning.find((i: { assessment: { state: string } }) => i.assessment.state === 'released');
    const res = await c.ravi!.get(`/me/results/${done.enrolmentId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ course: '2W Service Technician', outcome: 'pass', passMarkPct: expect.any(Number) });
    expect(res.body.criteria.length).toBeGreaterThan(0);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/review_reason|reviewed_by|reviewReason|reviewer|submitted_by/i);
  });

  it('a result not yet approved is not shown, and nobody else’s result is reachable', async () => {
    const poojaEnrolment = await ctx.db.selectFrom('enrolments').select('id').where('candidate_id', '=', ctx.ids.cand6!).where('batch_id', '=', ctx.ids.batchDone!).executeTakeFirstOrThrow();
    expect((await c.ravi!.get(`/me/results/${poojaEnrolment.id}`)).status).toBe(404);
    const raviEnrolment = (await c.ravi!.get('/me/learning')).body.items.find((i: { assessment: { state: string } }) => i.assessment.state === 'released').enrolmentId;
    expect((await c.learner!.get(`/me/results/${raviEnrolment}`)).status).toBe(404);
  });

  it('the wallet lists the person’s certificates with a check link; others cannot open them', async () => {
    const res = await c.ravi!.get('/me/credentials');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: ctx.ids.credentialRavi, typeLabel: 'Course completion record', status: 'active', verifyPath: `/verify/${ctx.ids.credentialRaviCode}` });
    expect((await c.ravi!.get(`/me/credentials/${ctx.ids.credentialRavi}`)).status).toBe(200);
    expect((await c.learner!.get(`/me/credentials/${ctx.ids.credentialRavi}`)).status).toBe(404);
  });

  it('a revoked certificate shows as revoked, without the internal reason', async () => {
    await c.secondAdmin!.post(`/admin/credentials/${ctx.ids.credentialRavi}/revoke`, { reason: 'Internal: issued in error by the centre' });
    const res = await c.ravi!.get('/me/credentials');
    expect(res.body.items[0].status).toBe('revoked');
    expect(JSON.stringify(res.body)).not.toMatch(/issued in error/);
  });
});
