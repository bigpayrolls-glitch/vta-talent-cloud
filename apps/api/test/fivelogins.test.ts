import { NOTICE_VERSION } from '@vta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientFromCookie, cookieFrom, EMAIL, loginEmail, loginPhone, nextIp, PHONE, setup, type Client, type Ctx } from './helpers.js';

/**
 * Five logins (decision of 27 Oct 2026): Admin, Employer, Learner, Trainer and Training Partner.
 * Independent trainers sign up themselves and are verified by an Admin; training partners do what
 * centre admins used to do, but only at the centres their organisation runs.
 */
let ctx: Ctx;
const c: Record<string, Client> = {};

beforeAll(async () => {
  ctx = await setup();
  c.admin = await loginEmail(ctx, EMAIL.superAdmin);
  c.partnerA = await loginEmail(ctx, EMAIL.partnerAdminA);
  c.partnerB = await loginEmail(ctx, EMAIL.partnerAdminB);
});
afterAll(() => ctx.close());

const post = (url: string, payload: object) => ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, payload, remoteAddress: nextIp() });
const names = (r: { body: { items: { name: string }[] } }) => r.body.items.map((x) => x.name);

const NEW_TRAINER = '+919900000601';
const signupBody = (code: string, over: Record<string, unknown> = {}) => ({
  phone: NEW_TRAINER,
  code,
  name: 'Ganesh Freelance Trainer',
  city: 'Tumakuru',
  specialisations: ['2W'],
  experienceYears: 6,
  acceptPrivacy: true,
  acceptTerms: true,
  noticeVersion: NOTICE_VERSION,
  ...over,
});
const registerCode = async (phone: string) => {
  await ctx.db.deleteFrom('otp_challenges').where('phone', '=', phone).execute();
  expect((await post('/auth/otp/request', { phone, purpose: 'register' })).statusCode).toBe(200);
  const code = ctx.mem.sentOtps.get(phone);
  if (!code) throw new Error(`No register code sent to ${phone}`);
  return code;
};
const batchBody = (over: Record<string, unknown>) => ({
  name: 'Five logins batch',
  courseId: ctx.ids.course2w,
  centreId: ctx.ids.centrePartnerA,
  trainerId: ctx.ids.trainerA,
  startDate: '2027-01-11',
  endDate: '2027-04-11',
  capacity: 10,
  ...over,
});

describe('an independent trainer signs up and an Admin verifies them', () => {
  let trainer: Client;
  let trainerId = '';

  it('refuses a sign-up without a skill area or with a login code instead of a registration code', async () => {
    const code = await registerCode(NEW_TRAINER);
    const noSkills = await post('/auth/register/trainer', signupBody(code, { specialisations: [] }));
    expect(noSkills.statusCode).toBe(400);
    expect(noSkills.json().error.fields.specialisations).toBe('Choose at least one skill area');
    expect((await post('/auth/register/trainer', signupBody('000000'))).statusCode).toBe(400);
    expect(await ctx.db.selectFrom('users').select('id').where('phone', '=', NEW_TRAINER).executeTakeFirst()).toBeUndefined();
  });

  it('signs up with a phone code and lands signed in, as a trainer with no centre and a pending profile', async () => {
    const code = await registerCode(NEW_TRAINER);
    const res = await post('/auth/register/trainer', signupBody(code));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true, existing: false });
    trainer = await clientFromCookie(ctx.app, cookieFrom(res));
    const me = (await trainer.get('/auth/me')).body;
    expect(me).toMatchObject({ name: 'Ganesh Freelance Trainer', status: 'active', portals: ['partner'] });
    trainerId = me.id;

    const roles = await ctx.db.selectFrom('role_assignments').select(['role', 'organisation_id', 'centre_id']).where('user_id', '=', trainerId).execute();
    expect(roles).toEqual([{ role: 'trainer', organisation_id: null, centre_id: null }]);
    const tp = await ctx.db.selectFrom('trainer_profiles').select(['verification_status', 'self_registered', 'city', 'experience_years', 'specialisations']).where('user_id', '=', trainerId).executeTakeFirstOrThrow();
    expect(tp).toEqual({ verification_status: 'pending', self_registered: true, city: 'Tumakuru', experience_years: 6, specialisations: ['2W'] });
    // No batches yet, and nothing at any centre.
    expect((await trainer.get('/batches')).body.items).toEqual([]);
  });

  it('every Admin is told there is a new trainer to verify', async () => {
    for (const email of [EMAIL.superAdmin, EMAIL.secondAdmin]) {
      const admin = await loginEmail(ctx, email);
      const n = (await admin.get('/notifications')).body.items[0];
      expect(n.title, email).toBe('New trainer to verify: Ganesh Freelance Trainer');
      expect(n.body).toMatch(/from Tumakuru signed up/);
    }
    expect((await c.partnerA!.get('/notifications')).body.items.map((x: { title: string }) => x.title)).not.toContain('New trainer to verify: Ganesh Freelance Trainer');
    const t = (await c.admin!.get(`/trainers/${trainerId}`)).body;
    expect(t).toMatchObject({ verificationStatus: 'pending', selfRegistered: true, city: 'Tumakuru', experienceYears: 6, centres: [] });
  });

  it('training partners cannot see or use the trainer until an Admin verifies them', async () => {
    expect(names(await c.partnerA!.get('/trainers'))).not.toContain('Ganesh Freelance Trainer');
    expect((await c.partnerA!.get(`/trainers/${trainerId}`)).status).toBe(404);
    const early = await c.partnerA!.post('/admin/batches', batchBody({ trainerId }));
    expect(early.status).toBe(400);
    expect(early.body.error.fields.trainerId).toBe('Trainer not verified');
  });

  it('a training partner or a trainer cannot verify trainers', async () => {
    expect((await c.partnerA!.post(`/admin/trainers/${trainerId}/verify`)).status).toBe(403);
    expect((await trainer.post(`/admin/trainers/${trainerId}/verify`)).status).toBe(403);
    expect((await ctx.db.selectFrom('trainer_profiles').select('verification_status').where('user_id', '=', trainerId).executeTakeFirstOrThrow()).verification_status).toBe('pending');
  });

  it('once an Admin verifies them, every training partner can find them', async () => {
    expect((await c.admin!.post(`/admin/trainers/${trainerId}/verify`)).body.verificationStatus).toBe('verified');
    expect(names(await c.partnerA!.get('/trainers'))).toContain('Ganesh Freelance Trainer');
    expect(names(await c.partnerB!.get('/trainers'))).toContain('Ganesh Freelance Trainer');
    expect((await c.partnerA!.get(`/trainers/${trainerId}`)).status).toBe(200);
  });

  it('a partner gives them a batch at their own centre, which makes them a trainer at that centre', async () => {
    const res = await c.partnerA!.post('/admin/batches', batchBody({ name: '2W Peenya with Ganesh', trainerId }));
    expect(res.status).toBe(201);
    const roles = await ctx.db.selectFrom('role_assignments').select(['organisation_id', 'centre_id']).where('user_id', '=', trainerId).where('role', '=', 'trainer').where('revoked_at', 'is', null).orderBy('centre_id').execute();
    expect(roles).toEqual(expect.arrayContaining([{ organisation_id: ctx.ids.partnerA, centre_id: ctx.ids.centrePartnerA }]));
    // The trainer now sees the batch and has been told about it.
    expect(names(await trainer.get('/batches'))).toEqual(['2W Peenya with Ganesh']);
    expect((await trainer.get('/notifications')).body.items[0].title).toBe("You're the trainer for 2W Peenya with Ganesh");
    expect((await trainer.get(`/centres/${ctx.ids.centrePartnerA}`)).status).toBe(200);
    // Another partner still cannot see the batch.
    expect((await c.partnerB!.get(`/batches/${res.body.id}`)).status).toBe(404);
  });

  it('signing up again with a number already registered just signs that person in', async () => {
    const code = await registerCode(PHONE.learner);
    const res = await post('/auth/register/trainer', signupBody(code, { phone: PHONE.learner }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, existing: true });
    const me = (await (await clientFromCookie(ctx.app, cookieFrom(res))).get('/auth/me')).body;
    expect(me.portals).toEqual(['learn']);
    expect(await ctx.db.selectFrom('trainer_profiles').select('user_id').where('user_id', '=', ctx.ids.learner!).executeTakeFirst()).toBeUndefined();
  });
});

describe('a training partner runs batches only at their own centres', () => {
  let batchId = '';

  it('creates a batch and enrols a candidate at their own centre', async () => {
    const res = await c.partnerB!.post('/admin/batches', batchBody({ name: 'EV Mysuru February 2027', courseId: ctx.ids.courseEv, centreId: ctx.ids.centrePartnerB, trainerId: ctx.ids.trainerB }));
    expect(res.status).toBe(201);
    batchId = res.body.id;
    expect((await c.partnerB!.post(`/admin/batches/${batchId}/enrolments`, { candidateIds: [ctx.ids.cand7] })).status).toBe(201);
    expect(names(await c.partnerB!.get('/admin/candidates'))).toContain('Kiran Patil');
    const roster = await c.partnerB!.get(`/batches/${batchId}/roster`);
    expect(roster.body.showContact).toBe(true);
    expect(roster.body.items.map((x: { name: string }) => x.name)).toEqual(['Kiran Patil']);
  });

  it('gets "Centre not found" at another partner’s centre or an AutoTalent Grid centre', async () => {
    for (const [centreId, trainerId] of [[ctx.ids.centrePartnerA, ctx.ids.trainerA], [ctx.ids.centreVta, ctx.ids.trainerVta]]) {
      const res = await c.partnerB!.post('/admin/batches', batchBody({ centreId, trainerId }));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Centre not found');
      expect(res.body.error.fields.centreId).toBe('Not found');
    }
  });

  it('gets "not found" for batches at centres it does not run', async () => {
    for (const id of [ctx.ids.batchA, ctx.ids.batchVta]) {
      expect((await c.partnerB!.post(`/admin/batches/${id}/enrolments`, { candidateIds: [ctx.ids.cand7] })).status).toBe(404);
      expect((await c.partnerB!.patch(`/admin/batches/${id}`, { capacity: 30 })).status).toBe(404);
      expect((await c.partnerB!.get(`/batches/${id}`)).status).toBe(404);
    }
    // And partner A cannot touch partner B's new batch.
    expect((await c.partnerA!.patch(`/admin/batches/${batchId}`, { capacity: 30 })).status).toBe(404);
    expect((await c.partnerA!.get(`/admin/candidates/${ctx.ids.cand7}`)).status).toBe(404);
  });

  it('cannot put another partner’s trainer on its batch', async () => {
    const res = await c.partnerB!.patch(`/admin/batches/${batchId}`, { trainerId: ctx.ids.trainerA });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.trainerId).toBe('Not a trainer at this centre');
  });
});

describe('a training partner adds trainers only at their own centres', () => {
  it('adds a trainer at their own centre, who belongs to their organisation', async () => {
    const res = await c.partnerA!.post('/admin/trainers', { name: 'Rekha Peenya Trainer', phone: '9900000602', centreId: ctx.ids.centrePartnerA, specialisations: ['2W'] });
    expect(res.status).toBe(201);
    const ra = await ctx.db.selectFrom('role_assignments').select(['organisation_id', 'centre_id']).where('user_id', '=', res.body.id).executeTakeFirstOrThrow();
    expect(ra).toEqual({ organisation_id: ctx.ids.partnerA, centre_id: ctx.ids.centrePartnerA });
    expect(names(await c.partnerA!.get('/trainers'))).toContain('Rekha Peenya Trainer');
    expect(names(await c.partnerB!.get('/trainers'))).not.toContain('Rekha Peenya Trainer');
    // A new trainer still needs an Admin to verify them.
    expect((await c.partnerA!.get(`/trainers/${res.body.id}`)).body.verificationStatus).toBe('pending');
  });

  it('cannot add a trainer at another partner’s centre or an AutoTalent Grid centre', async () => {
    for (const [centreId, phone] of [[ctx.ids.centrePartnerB, '9900000603'], [ctx.ids.centreVta, '9900000604']]) {
      const res = await c.partnerA!.post('/admin/trainers', { name: 'Not Mine', phone, centreId });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.centreId).toBe('Not one of your centres');
      expect(await ctx.db.selectFrom('users').select('id').where('phone', '=', `+91${phone}`).executeTakeFirst()).toBeUndefined();
    }
  });

  it('cannot assign trainers to a centre it does not run, or touch another partner’s trainers', async () => {
    const away = await c.partnerA!.post(`/admin/trainers/${ctx.ids.trainerPending}/centres`, { centreId: ctx.ids.centrePartnerB });
    expect(away.status).toBe(400);
    expect(away.body.error.fields.centreId).toBe('Not one of your centres');
    expect((await c.partnerA!.post(`/admin/trainers/${ctx.ids.trainerB}/centres`, { centreId: ctx.ids.centrePartnerA })).status).toBe(404);
    expect((await c.partnerA!.patch(`/admin/trainers/${ctx.ids.trainerB}`, { specialisations: ['2W'] })).status).toBe(404);
  });

  it('can bring a verified independent trainer to their own centre', async () => {
    expect((await c.partnerB!.post(`/admin/trainers/${ctx.ids.trainerFree}/centres`, { centreId: ctx.ids.centrePartnerB })).status).toBe(201);
    const free = await loginPhone(ctx, PHONE.trainerFree);
    expect((await free.get(`/centres/${ctx.ids.centrePartnerB}`)).status).toBe(200);
  });

  it('employers, learners and trainers cannot add trainers', async () => {
    const callers = [await loginEmail(ctx, EMAIL.employerAdminA), await loginPhone(ctx, PHONE.learner), await loginPhone(ctx, PHONE.trainerA)];
    for (const caller of callers) {
      expect((await caller.post('/admin/trainers', { name: 'Sneaky', phone: '9900000605', centreId: ctx.ids.centrePartnerA })).status).toBe(403);
    }
  });
});
