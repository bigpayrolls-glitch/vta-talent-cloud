import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL, loginEmail, loginPhone, PHONE, setup, type Client, type Ctx } from './helpers.js';

/**
 * Training partner course creation and approval journey (wireframe of 27 Oct 2026):
 * a partner builds a course in four steps and submits it; AutoTalent Grid approves and publishes it,
 * or sends it back; learners see it only once published.
 */
let ctx: Ctx;
const c: Record<string, Client> = {};
const pub = (url: string) => ctx.app.inject({ method: 'GET', url: `/api/v1${url}` });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

beforeAll(async () => {
  ctx = await setup();
  c.partnerA = await loginEmail(ctx, EMAIL.partnerAdminA);
  c.partnerB = await loginEmail(ctx, EMAIL.partnerAdminB);
  c.admin = await loginEmail(ctx, EMAIL.superAdmin);
  c.employer = await loginEmail(ctx, EMAIL.employerAdminA);
  c.trainer = await loginPhone(ctx, PHONE.trainerA);
  c.learner = await loginPhone(ctx, PHONE.learner);
});
afterAll(() => ctx.close());

const details = {
  title: 'Two-Wheeler FI Diagnostics',
  skillArea: '2W',
  courseType: 'skill_upgrade',
  level: 'beginner_to_intermediate',
  description: 'Fuel-injection diagnostics for current two-wheelers, with scan tools and live faults.',
  city: 'Bengaluru',
  deliveryMode: 'blended',
  durationValue: 4,
  durationUnit: 'weeks',
};

describe('partner course wizard', () => {
  let id = '';

  it('step 1 creates a draft owned by the partner; nobody else sees it', async () => {
    const r = await c.partnerA!.post('/partner/courses', details);
    expect(r.status).toBe(201);
    id = r.body.id;
    const d = (await c.partnerA!.get(`/partner/courses/${id}`)).body;
    expect(d).toMatchObject({ title: details.title, approvalStatus: 'draft', editable: true, owner: { id: ctx.ids.partnerA } });
    expect(d.history.map((h: { action: string }) => h.action)).toEqual(['created']);
    expect((await c.partnerB!.get(`/partner/courses/${id}`)).status).toBe(404);
    expect((await c.partnerB!.get(`/courses/${id}`)).status).toBe(404);
    expect((await c.admin!.get(`/courses/${id}`)).status).toBe(404); // an unsent draft is the partner's own
    expect((await c.employer!.post('/partner/courses', details)).status).toBe(403);
    expect((await c.trainer!.get('/partner/courses')).status).toBe(403);
  });

  it('submitting an incomplete course lists what is missing', async () => {
    const r = await c.partnerA!.post(`/partner/courses/${id}/submit`);
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.error.fields)).toEqual(expect.arrayContaining(['modules', 'skills', 'learningOutcomes', 'certificateType', 'firstBatch']));
  });

  it('steps 2 and 3 save content, fee with GST, and the first batch at the partner\'s own centre', async () => {
    const content = await c.partnerA!.patch(`/partner/courses/${id}`, {
      modules: [{ name: 'FI system basics', hours: 20 }, { name: 'Scan tool diagnostics', hours: 30 }],
      skills: ['FI System', 'Electrical Diagnostics', 'FI System'],
      prerequisites: '10th pass',
      learningOutcomes: ['Read and clear FI fault codes'],
    });
    expect(content.status).toBe(200);
    // Someone else's centre is refused.
    const bad = await c.partnerA!.patch(`/partner/courses/${id}`, {
      firstBatch: { name: 'FI Mysuru', centreId: ctx.ids.centrePartnerB, trainerId: ctx.ids.trainerB, startDate: '2026-12-01', endDate: '2026-12-31', capacity: 20 },
    });
    expect(bad.status).toBe(400);
    const fee = await c.partnerA!.patch(`/partner/courses/${id}`, {
      feeRupees: 5000,
      gstPct: 18,
      certificateType: 'Partner Certificate',
      firstBatch: { name: 'FI Peenya December 2026', centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2026-12-01', endDate: '2026-12-31', capacity: 20, classTimings: 'Mon–Fri, 2–5 PM' },
    });
    expect(fee.status).toBe(200);
    expect((await c.partnerA!.patch(`/partner/courses/${id}`, { gstPct: 7 })).status).toBe(400);
    const d = (await c.partnerA!.get(`/partner/courses/${id}`)).body;
    expect(d).toMatchObject({ trainingHours: 50, skills: ['FI System', 'Electrical Diagnostics'], feeRupees: 5000, gstPct: 18, totalFeeRupees: 5900 });
    expect(d.firstBatch).toMatchObject({ centreName: 'Skill Bridge Peenya Centre', trainerName: 'Prakash Trainer', classTimings: 'Mon–Fri, 2–5 PM' });
  });

  it('takes a JPG or PNG picture up to 2 MB, and refuses anything else', async () => {
    expect((await c.partnerA!.upload(`/partner/courses/${id}/image`, Buffer.from('%PDF-1.4 hello'))).status).toBe(400);
    expect((await c.partnerA!.upload(`/partner/courses/${id}/image`, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]))).status).toBe(413);
    const r = await c.partnerA!.upload(`/partner/courses/${id}/image`, PNG);
    expect(r.status).toBe(200);
    expect(r.body.imageUrl).toMatch(`/api/v1/courses/${id}/image`);
    const img = await ctx.app.inject({ method: 'GET', url: r.body.imageUrl.replace(/\?.*/, ''), headers: { cookie: c.partnerA!.cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect((await pub(`/public/courses/${id}/image`)).statusCode).toBe(404); // not published yet
  });

  it('a batch cannot be created for a course that is not published', async () => {
    const r = await c.partnerA!.post('/admin/batches', { name: 'Too early', courseId: id, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2026-12-01', endDate: '2026-12-31', capacity: 10 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/not published/);
  });

  it('submits for admin review: locked for the partner, admins notified, not visible to learners', async () => {
    const r = await c.partnerA!.post(`/partner/courses/${id}/submit`);
    expect(r.status).toBe(200);
    expect(r.body.approvalStatus).toBe('submitted');
    expect((await c.partnerA!.patch(`/partner/courses/${id}`, { title: 'Changed after submit' })).status).toBe(400);
    const note = await ctx.db.selectFrom('notifications').select(['template', 'link']).where('user_id', '=', ctx.ids.superAdmin!).where('template', '=', 'course_submitted').orderBy('created_at', 'desc').executeTakeFirst();
    expect(note?.link).toBe(`/admin/course-approvals/${id}`);
    expect((await pub(`/public/courses/${id}`)).statusCode).toBe(404);
    const queue = (await c.admin!.get('/admin/course-reviews?approvalStatus=submitted')).body;
    expect(queue.items.map((i: { id: string }) => i.id)).toContain(id);
    expect(queue.counts.submitted).toBeGreaterThanOrEqual(2);
    expect((await c.partnerA!.get('/admin/course-reviews')).status).toBe(403);
  });

  it('request changes needs a note; the partner sees it, edits and resubmits', async () => {
    expect((await c.admin!.post(`/admin/course-reviews/${id}/decision`, { action: 'request_changes' })).status).toBe(400);
    const r = await c.admin!.post(`/admin/course-reviews/${id}/decision`, { action: 'request_changes', note: 'Add a workshop safety module.' });
    expect(r.status).toBe(200);
    const d = (await c.partnerA!.get(`/partner/courses/${id}`)).body;
    expect(d).toMatchObject({ approvalStatus: 'changes_requested', reviewNote: 'Add a workshop safety module.', editable: true });
    const partnerNote = await ctx.db.selectFrom('notifications').select('template').where('user_id', '=', ctx.ids.partnerAdminA!).where('template', '=', 'course_changes_requested').executeTakeFirst();
    expect(partnerNote).toBeTruthy();
    await c.partnerA!.patch(`/partner/courses/${id}`, { modules: [{ name: 'FI system basics', hours: 20 }, { name: 'Scan tool diagnostics', hours: 30 }, { name: 'Workshop safety', hours: 6 }] });
    expect((await c.partnerA!.post(`/partner/courses/${id}/submit`)).status).toBe(200);
    const h = (await c.admin!.get(`/admin/course-reviews/${id}`)).body;
    expect(h.history.map((e: { action: string }) => e.action)).toEqual(['created', 'submitted', 'changes_requested', 'submitted']);
    expect(h.history[3].note).toBe('Resubmitted after changes');
    expect(h.partner).toMatchObject({ name: 'Skill Bridge Foundation (demo)', verificationStatus: 'verified' });
  });

  it('approve & publish: learners see it with GST included, the first batch opens, modules become assessment criteria', async () => {
    const r = await c.admin!.post(`/admin/course-reviews/${id}/decision`, { action: 'publish' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ approvalStatus: 'published', batchProblem: null });
    expect(r.body.batchId).toBeTruthy();
    const card = (await pub('/public/courses')).json().items.find((i: { id: string }) => i.id === id);
    expect(card).toMatchObject({ feeRupees: 5900, gstPct: 18, providers: ['Skill Bridge Foundation (demo)'], skillTags: ['FI System', 'Electrical Diagnostics'], courseType: 'skill_upgrade' });
    expect(card.imageUrl).toMatch(`/api/v1/public/courses/${id}/image`);
    expect((await pub(`/public/courses/${id}/image`)).statusCode).toBe(200);
    const detail = (await pub(`/public/courses/${id}`)).json();
    expect(detail.modules).toHaveLength(3);
    expect(detail.learningOutcomes).toEqual(['Read and clear FI fault codes']);
    expect(detail.batches[0]).toMatchObject({ name: 'FI Peenya December 2026', seatsLeft: 20 });
    const criteria = await ctx.db.selectFrom('assessment_criteria').select('label').where('course_id', '=', id).orderBy('sort_order').execute();
    expect(criteria.map((x) => x.label)).toEqual(['FI system basics', 'Scan tool diagnostics', 'Workshop safety']);
    // The learner pays the fee plus GST.
    const quote = (await c.learner!.get(`/me/enrol/${r.body.batchId}`)).body;
    expect(quote.course.feeRupees).toBe(5900);
    expect((await c.partnerA!.patch(`/partner/courses/${id}`, { title: 'Edit after publish' })).status).toBe(400);
  });

  it('course management: the partner adds more batches (with class timings); partner B cannot use this course', async () => {
    const ok = await c.partnerA!.post('/admin/batches', { name: 'FI Peenya January 2027', courseId: id, centreId: ctx.ids.centrePartnerA, trainerId: ctx.ids.trainerA, startDate: '2027-01-11', endDate: '2027-02-12', capacity: 15, classTimings: 'Sat–Sun, 9 AM – 1 PM' });
    expect(ok.status).toBe(201);
    const d = (await c.partnerA!.get(`/partner/courses/${id}`)).body;
    expect(d.batches.map((b: { name: string }) => b.name)).toEqual(['FI Peenya January 2027', 'FI Peenya December 2026']);
    expect(d.batches[0].classTimings).toBe('Sat–Sun, 9 AM – 1 PM');
    const other = await c.partnerB!.post('/admin/batches', { name: 'Not mine', courseId: id, centreId: ctx.ids.centrePartnerB, trainerId: ctx.ids.trainerB, startDate: '2027-01-11', endDate: '2027-02-12', capacity: 15 });
    expect(other.status).toBe(400);
    // Published, so every partner and trainer can read it now.
    expect((await c.partnerB!.get(`/courses/${id}`)).status).toBe(200);
  });

  it('admins can hide a published course from learners and show it again', async () => {
    expect((await c.admin!.post(`/admin/course-reviews/${id}/unpublish`, { note: 'Fee under review' })).status).toBe(200);
    expect((await pub(`/public/courses/${id}`)).statusCode).toBe(404);
    expect((await c.admin!.post(`/admin/course-reviews/${id}/republish`)).status).toBe(200);
    expect((await pub(`/public/courses/${id}`)).statusCode).toBe(200);
  });

  it('the partner dashboard counts courses, batches, enrolments and revenue, with recent activity', async () => {
    const d = (await c.partnerA!.get('/partner/dashboard')).body;
    expect(d.courses).toMatchObject({ published: 1, inReview: 1 });
    expect(d.batches.total).toBeGreaterThanOrEqual(4);
    expect(d.enrolments).toBeGreaterThanOrEqual(4);
    expect(typeof d.revenueRupees).toBe('number');
    expect(d.activity[0].text).toMatch(/FI Peenya January 2027|published/);
  });
});

describe('reject and delete', () => {
  it('rejects the seeded course with a reason; it can no longer be edited or submitted', async () => {
    const id = ctx.ids.partnerCourseSubmitted!;
    expect((await c.admin!.post(`/admin/course-reviews/${id}/decision`, { action: 'reject', note: 'Duplicate of an existing course.' })).status).toBe(200);
    expect((await c.admin!.post(`/admin/course-reviews/${id}/decision`, { action: 'publish' })).status).toBe(400);
    expect((await c.partnerA!.patch(`/partner/courses/${id}`, { title: 'Try again' })).status).toBe(400);
    const list = (await c.partnerA!.get('/partner/courses?approvalStatus=rejected')).body;
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([id]);
  });

  it('an unsent draft can be deleted by its partner only', async () => {
    const id = ctx.ids.partnerCourseDraft!;
    expect((await c.partnerB!.del(`/partner/courses/${id}`)).status).toBe(404);
    expect((await c.partnerA!.del(`/partner/courses/${id}`)).status).toBe(200);
    expect((await c.partnerA!.get(`/partner/courses/${id}`)).status).toBe(404);
  });
});

describe('fixes of 28 Oct 2026', () => {
  it('module time may be part of an hour (minutes typed in the wizard become hours) and long skills save', async () => {
    const r = await c.partnerA!.post('/partner/courses', { ...details, title: 'EV Battery and Motor Safety Awareness Program' });
    const id = r.body.id;
    const longSkill = 'Follow EV battery handling and maintenance safety procedures, including PPE and isolation';
    const save = await c.partnerA!.patch(`/partner/courses/${id}`, {
      modules: [{ name: 'Introduction to Electric Two-Wheelers', hours: 0.5 }, { name: 'EV Battery Types and Components', hours: 1 }, { name: 'Charging safety', hours: '0.75' }],
      skills: ['Electrical Diagnostics', longSkill],
      learningOutcomes: ['Recognize when professional help is needed and escalate early to a qualified EV technician.'],
    });
    expect(save.status).toBe(200);
    const d = (await c.partnerA!.get(`/partner/courses/${id}`)).body;
    expect(d.modules).toEqual([
      { name: 'Introduction to Electric Two-Wheelers', hours: 0.5 },
      { name: 'EV Battery Types and Components', hours: 1 },
      { name: 'Charging safety', hours: 0.75 },
    ]);
    expect(d.skills).toContain(longSkill);
    const row = await ctx.db.selectFrom('courses').select('training_hours').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.training_hours).toBe(3); // 2.25 hours in all, rounded up for the course total
    const tooShort = await c.partnerA!.patch(`/partner/courses/${id}`, { modules: [{ name: 'Blink', hours: 0.01 }] });
    expect(tooShort.body.error.fields['modules.0.hours']).toBe('At least 3 minutes');
  });
});

describe('hybrid modules', () => {
  it('a module can be split into theory and practical time; its total is their sum', async () => {
    const r = await c.partnerA!.post('/partner/courses', { ...details, title: 'EV Hybrid Technician', deliveryMode: 'blended' });
    const id = r.body.id;
    const save = await c.partnerA!.patch(`/partner/courses/${id}`, {
      modules: [
        { name: 'EV Fundamentals & Vehicle Architecture', theoryHours: 8, practicalHours: 4 },
        { name: 'Safety walk-through', theoryHours: '0.5', practicalHours: 0 },
      ],
    });
    expect(save.status).toBe(200);
    const d = (await c.partnerA!.get(`/partner/courses/${id}`)).body;
    expect(d.modules).toEqual([
      { name: 'EV Fundamentals & Vehicle Architecture', hours: 12, theoryHours: 8, practicalHours: 4 },
      { name: 'Safety walk-through', hours: 0.5, theoryHours: 0.5, practicalHours: 0 },
    ]);
    const row = await ctx.db.selectFrom('courses').select('training_hours').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.training_hours).toBe(13);
    const empty = await c.partnerA!.patch(`/partner/courses/${id}`, { modules: [{ name: 'Nothing yet', theoryHours: 0, practicalHours: 0 }] });
    expect(empty.body.error.fields['modules.0.hours']).toBe('At least 3 minutes');
  });
});

describe('centres', () => {
  it('an Admin deletes an unused centre; a centre with batches can only be deactivated; partners cannot delete', async () => {
    const add = await c.admin!.post('/admin/centres', { name: 'VOC Bengaluru', city: 'Bengaluru', organisationId: ctx.ids.partnerA });
    expect(add.status).toBe(201);
    expect((await c.partnerA!.get('/centres')).body.items.map((x: { name: string }) => x.name)).toContain('VOC Bengaluru');
    expect((await c.partnerA!.del(`/admin/centres/${add.body.id}`)).status).toBe(403);
    expect((await c.admin!.del(`/admin/centres/${add.body.id}`)).body).toEqual({ ok: true });
    expect((await c.partnerA!.get('/centres')).body.items.map((x: { name: string }) => x.name)).not.toContain('VOC Bengaluru');
    const used = await c.admin!.del(`/admin/centres/${ctx.ids.centrePartnerA}`);
    expect(used.status).toBe(409);
    expect(used.body.error.message).toMatch(/Deactivate it instead/);
  });
});
