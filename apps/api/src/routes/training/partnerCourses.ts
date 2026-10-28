import {
  COURSE_APPROVAL_STATUSES,
  COURSE_IMAGE_MAX_BYTES,
  courseReviewSchema,
  feeWithGst,
  listQuerySchema,
  partnerCourseDetailsSchema,
  partnerCourseSaveSchema,
  SKILL_AREAS,
  uuidSchema,
  type CourseHistoryEvent,
  type PartnerCourse,
} from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { Course, Database, FirstBatchPlan } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { formatDay, todayIst } from '../../lib/dates.js';
import { ApiError, invalid, notFound } from '../../lib/errors.js';
import { notify, orgMembers, PARTNER_TEAM, vtaReviewers } from '../../lib/notify.js';
import { sniffMime } from '../../lib/storage.js';
import { iso, parse } from '../../lib/validate.js';
import { partnerCentres, partnerOrgs } from '../../policy/index.js';
import { grantRole } from '../admin/roles.js';
import { assertTrainerFits } from './batches.js';
import { courseImageUrl } from './courses.js';

type Executor = Kysely<Database> | Transaction<Database>;
const idParam = z.object({ id: uuidSchema });

/** Partners may change a course only while it is with them: a draft, or one AutoTalent Grid sent back. */
const EDITABLE = ['draft', 'changes_requested'] as const;

type CourseRow = Course & { owner_name?: string | null };

function toDto(c: CourseRow, extra: { batch_count?: string | number; enrolled?: string | number; centreName?: string; trainerName?: string } = {}): PartnerCourse {
  const fee = Math.round(c.fee_paise / 100);
  return {
    id: c.id,
    title: c.title,
    skillArea: c.skill_area,
    courseType: c.course_type as PartnerCourse['courseType'],
    level: c.level as PartnerCourse['level'],
    description: c.description,
    city: c.city,
    deliveryMode: c.delivery_mode as PartnerCourse['deliveryMode'],
    durationValue: c.duration_value,
    durationUnit: c.duration_unit as PartnerCourse['durationUnit'],
    trainingHours: c.training_hours,
    modules: c.modules ?? [],
    skills: c.skills ?? [],
    prerequisites: c.prerequisites,
    learningOutcomes: c.learning_outcomes ?? [],
    feeRupees: fee,
    gstPct: c.gst_pct,
    totalFeeRupees: feeWithGst(fee, c.gst_pct).totalRupees,
    certificateType: c.certificate_type,
    firstBatch: c.first_batch
      ? { ...c.first_batch, classTimings: c.first_batch.classTimings ?? undefined, centreName: extra.centreName, trainerName: extra.trainerName }
      : null,
    imageUrl: courseImageUrl(c),
    approvalStatus: c.approval_status,
    active: c.status === 'active',
    reviewNote: c.review_note,
    submittedAt: iso(c.submitted_at),
    publishedAt: iso(c.published_at),
    updatedAt: iso(c.updated_at)!,
    owner: c.owner_organisation_id ? { id: c.owner_organisation_id, name: c.owner_name ?? '' } : null,
    ...(extra.batch_count !== undefined && { batchCount: Number(extra.batch_count) }),
    ...(extra.enrolled !== undefined && { enrolled: Number(extra.enrolled) }),
  };
}

function toRow(b: z.infer<typeof partnerCourseSaveSchema>) {
  const row: Record<string, unknown> = {};
  if (b.title !== undefined) row.title = b.title;
  if (b.skillArea !== undefined) row.skill_area = b.skillArea;
  if (b.courseType !== undefined) row.course_type = b.courseType;
  if (b.level !== undefined) row.level = b.level;
  if (b.description !== undefined) row.description = b.description || null;
  if (b.city !== undefined) row.city = b.city;
  if (b.deliveryMode !== undefined) row.delivery_mode = b.deliveryMode;
  if (b.durationValue !== undefined) row.duration_value = b.durationValue;
  if (b.durationUnit !== undefined) row.duration_unit = b.durationUnit;
  if (b.modules !== undefined) {
    row.modules = JSON.stringify(b.modules);
    const hours = b.modules.reduce((n, m) => n + m.hours, 0);
    row.training_hours = hours > 0 ? hours : null;
  }
  if (b.skills !== undefined) row.skills = [...new Set(b.skills)];
  if (b.prerequisites !== undefined) row.prerequisites = b.prerequisites || null;
  if (b.learningOutcomes !== undefined) row.learning_outcomes = b.learningOutcomes;
  if (b.feeRupees !== undefined) row.fee_paise = b.feeRupees * 100;
  if (b.gstPct !== undefined) row.gst_pct = b.gstPct;
  if (b.certificateType !== undefined) row.certificate_type = b.certificateType;
  if (b.firstBatch !== undefined) {
    row.first_batch = b.firstBatch ? JSON.stringify({ ...b.firstBatch, classTimings: b.firstBatch.classTimings || null } satisfies FirstBatchPlan) : null;
  }
  return row;
}

async function history(db: Executor, courseId: string): Promise<CourseHistoryEvent[]> {
  const rows = await db
    .selectFrom('course_review_events as e')
    .leftJoin('users as u', 'u.id', 'e.actor_id')
    .select(['e.action', 'e.note', 'e.created_at', 'u.name'])
    .where('e.course_id', '=', courseId)
    .orderBy('e.created_at')
    .execute();
  return rows.map((r) => ({ action: r.action, note: r.note, actor: r.name, at: iso(r.created_at)! }));
}

async function firstBatchNames(db: Executor, plan: FirstBatchPlan | null) {
  if (!plan) return {};
  const centre = await db.selectFrom('centres').select('name').where('id', '=', plan.centreId).executeTakeFirst();
  const trainer = await db.selectFrom('users').select('name').where('id', '=', plan.trainerId).executeTakeFirst();
  return { centreName: centre?.name, trainerName: trainer?.name };
}

async function courseBatches(db: Executor, courseId: string) {
  const rows = await db
    .selectFrom('batches as b')
    .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
    .innerJoin('users as t', 't.id', 'b.trainer_id')
    .select([
      'b.id', 'b.name', 'b.status', 'b.start_date', 'b.end_date', 'b.capacity', 'b.class_timings', 'ce.name as centre', 'ce.city', 't.name as trainer',
      sql<string>`(select count(*) from enrolments e where e.batch_id = b.id and e.status <> 'withdrawn')`.as('enrolled'),
    ])
    .where('b.course_id', '=', courseId)
    .orderBy('b.start_date', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    capacity: r.capacity,
    enrolled: Number(r.enrolled),
    classTimings: r.class_timings,
    centre: r.centre,
    city: r.city,
    trainer: r.trainer,
  }));
}

/**
 * What is still missing before a course can go to AutoTalent Grid, by wizard step and field.
 * The first batch is checked against the partner's own centres and trainers.
 */
async function missingForSubmit(db: Executor, c: Course, centres: string[]): Promise<Record<string, string>> {
  const m: Record<string, string> = {};
  if (!c.course_type) m.courseType = 'Choose a course type';
  if (!c.city) m.city = 'Enter the city';
  if (!c.description || c.description.length < 20) m.description = 'Describe the course in at least 20 characters';
  if (!(c.modules ?? []).length) m.modules = 'Add at least one module';
  if (!(c.skills ?? []).length) m.skills = 'Choose at least one skill';
  if (!(c.learning_outcomes ?? []).length) m.learningOutcomes = 'Add at least one learning outcome';
  if (!c.certificate_type) m.certificateType = 'Choose a certificate type';
  const fb = c.first_batch;
  if (!fb) {
    m.firstBatch = 'Plan the first batch';
  } else {
    if (!centres.includes(fb.centreId)) m['firstBatch.centreId'] = 'Choose one of your centres';
    else {
      const centre = await db.selectFrom('centres').select('status').where('id', '=', fb.centreId).executeTakeFirst();
      if (centre?.status !== 'active') m['firstBatch.centreId'] = 'This centre is inactive';
    }
    if (fb.startDate < todayIst()) m['firstBatch.startDate'] = 'The first batch must start today or later';
    if (!m['firstBatch.centreId']) {
      try {
        await assertTrainerFits(db, fb.trainerId, fb.centreId);
      } catch (e) {
        if (e instanceof ApiError) m['firstBatch.trainerId'] = e.fields?.trainerId ?? e.message;
        else throw e;
      }
    }
  }
  return m;
}

export const partnerCourseRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /** The partner's organisation (one per login). */
  function myOrg(req: FastifyRequest): string {
    const org = partnerOrgs(req.actor!)[0];
    if (!org) throw notFound('Training partner');
    return org;
  }

  async function loadOwn(ex: Executor, req: FastifyRequest, id: string, opts: { forUpdate?: boolean } = {}): Promise<Course> {
    let q = ex.selectFrom('courses').selectAll().where('id', '=', id).where('owner_organisation_id', 'in', partnerOrgs(req.actor!).length ? partnerOrgs(req.actor!) : ['00000000-0000-0000-0000-000000000000']);
    if (opts.forUpdate) q = q.forUpdate();
    const c = await q.executeTakeFirst();
    if (!c) throw notFound('Course');
    return c;
  }

  function assertEditable(c: Course) {
    if (!(EDITABLE as readonly string[]).includes(c.approval_status)) {
      throw invalid(
        c.approval_status === 'submitted'
          ? 'This course is with AutoTalent Grid for review, so it cannot be changed now.'
          : c.approval_status === 'published'
            ? 'This course is published. Contact AutoTalent Grid to change it.'
            : 'This course was not approved and cannot be changed.',
      );
    }
  }

  // ------------------------------------------------------------------ dashboard (wireframe screen 1)

  app.get('/partner/dashboard', { config: { permission: 'course.author' } }, async (req) => {
    const org = myOrg(req);
    const centres = await partnerCentres(db, req.actor!);
    const courseCounts = await db
      .selectFrom('courses')
      .select(['approval_status', sql<string>`count(*)`.as('n')])
      .where('owner_organisation_id', '=', org)
      .groupBy('approval_status')
      .execute();
    const byStatus = Object.fromEntries(courseCounts.map((r) => [r.approval_status, Number(r.n)]));
    const none = ['00000000-0000-0000-0000-000000000000'];
    const centreIds = centres.length ? centres : none;
    const batches = await db
      .selectFrom('batches')
      .select(['status', sql<string>`count(*)`.as('n')])
      .where('centre_id', 'in', centreIds)
      .groupBy('status')
      .execute();
    const batchBy = Object.fromEntries(batches.map((r) => [r.status, Number(r.n)]));
    const { enrolments } = await db
      .selectFrom('enrolments as e')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .select(sql<string>`count(*)`.as('enrolments'))
      .where('b.centre_id', 'in', centreIds)
      .where('e.status', '<>', 'withdrawn')
      .executeTakeFirstOrThrow();
    const { revenue } = await db
      .selectFrom('course_payments as p')
      .innerJoin('batches as b', 'b.id', 'p.batch_id')
      .select(sql<string>`coalesce(sum(p.amount_paise), 0)`.as('revenue'))
      .where('b.centre_id', 'in', centreIds)
      .executeTakeFirstOrThrow();

    // Recent activity: course review steps, new enrolments and new batches, newest first.
    const reviews = await db
      .selectFrom('course_review_events as e')
      .innerJoin('courses as c', 'c.id', 'e.course_id')
      .select(['e.action', 'e.note', 'e.created_at', 'c.title', 'c.id'])
      .where('c.owner_organisation_id', '=', org)
      .orderBy('e.created_at', 'desc')
      .limit(8)
      .execute();
    const enrols = await db
      .selectFrom('enrolments as e')
      .innerJoin('batches as b', 'b.id', 'e.batch_id')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .select(['e.enrolled_at', 'u.name', 'b.name as batch', 'b.id'])
      .where('b.centre_id', 'in', centreIds)
      .where('e.status', '<>', 'withdrawn')
      .orderBy('e.enrolled_at', 'desc')
      .limit(8)
      .execute();
    const newBatches = await db
      .selectFrom('batches as b')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .select(['b.created_at', 'b.name', 'b.id', 'c.title'])
      .where('b.centre_id', 'in', centreIds)
      .orderBy('b.created_at', 'desc')
      .limit(8)
      .execute();
    const REVIEW_TEXT: Record<string, string> = {
      created: 'Course created as a draft',
      submitted: 'Course submitted for admin review',
      changes_requested: 'AutoTalent Grid requested changes',
      rejected: 'AutoTalent Grid rejected the course',
      published: 'Course approved and published',
      unpublished: 'Course unpublished',
      republished: 'Course published again',
    };
    const activity = [
      ...reviews.map((r) => ({ kind: 'course' as const, text: `${REVIEW_TEXT[r.action] ?? r.action}: ${r.title}`, at: iso(r.created_at)!, link: `/partner/courses/${r.id}` })),
      ...enrols.map((r) => ({ kind: 'enrolment' as const, text: `${r.name} enrolled in ${r.batch}`, at: iso(r.enrolled_at)!, link: `/partner/batches/${r.id}` })),
      ...newBatches.map((r) => ({ kind: 'batch' as const, text: `Batch created: ${r.name} (${r.title})`, at: iso(r.created_at)!, link: `/partner/batches/${r.id}` })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8);

    return {
      courses: {
        total: courseCounts.reduce((n, r) => n + Number(r.n), 0),
        published: byStatus.published ?? 0,
        inReview: byStatus.submitted ?? 0,
        needsAction: (byStatus.changes_requested ?? 0) + (byStatus.draft ?? 0),
      },
      batches: {
        total: batches.filter((r) => r.status !== 'cancelled').reduce((n, r) => n + Number(r.n), 0),
        ongoing: batchBy.active ?? 0,
        upcoming: batchBy.planned ?? 0,
      },
      enrolments: Number(enrolments),
      revenueRupees: Math.round(Number(revenue) / 100),
      activity,
    };
  });

  // ------------------------------------------------------------------ courses list (screen 2)

  app.get('/partner/courses', { config: { permission: 'course.author' } }, async (req) => {
    const f = parse(
      listQuerySchema.extend({ skillArea: z.enum(SKILL_AREAS).optional(), approvalStatus: z.enum(COURSE_APPROVAL_STATUSES).optional() }),
      req.query,
    );
    const org = myOrg(req);
    let q = db.selectFrom('courses as c').where('c.owner_organisation_id', '=', org);
    const counts = await q.select(['c.approval_status', sql<string>`count(*)`.as('n')]).groupBy('c.approval_status').execute();
    if (f.skillArea) q = q.where('c.skill_area', '=', f.skillArea);
    if (f.approvalStatus) q = q.where('c.approval_status', '=', f.approvalStatus);
    if (f.q) q = q.where('c.title', 'ilike', `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .selectAll('c')
      .select([
        sql<string>`(select count(*) from batches b where b.course_id = c.id and b.status <> 'cancelled')`.as('batch_count'),
        sql<string>`(select count(*) from enrolments e join batches b on b.id = e.batch_id where b.course_id = c.id and e.status <> 'withdrawn')`.as('enrolled'),
      ])
      .orderBy('c.updated_at', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => toDto(r, { batch_count: r.batch_count, enrolled: r.enrolled })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
      counts: Object.fromEntries(counts.map((r) => [r.approval_status, Number(r.n)])),
    };
  });

  app.get('/partner/courses/:id', { config: { permission: 'course.author' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await loadOwn(db, req, id);
    return {
      ...toDto(c, await firstBatchNames(db, c.first_batch)),
      history: await history(db, id),
      batches: await courseBatches(db, id),
      editable: (EDITABLE as readonly string[]).includes(c.approval_status),
    };
  });

  // ------------------------------------------------------------------ the wizard (screens 3–6)

  /** Step 1 creates the draft. */
  app.post('/partner/courses', { config: { permission: 'course.author' } }, async (req, reply) => {
    const b = parse(partnerCourseDetailsSchema, req.body);
    const org = myOrg(req);
    const id = newId();
    await db.transaction().execute(async (trx) => {
      const row = {
        id,
        ...toRow(b),
        title: b.title,
        skill_area: b.skillArea,
        level: b.level,
        delivery_mode: b.deliveryMode,
        duration_value: b.durationValue,
        duration_unit: b.durationUnit,
        // Partner courses follow the usual pass rules; AutoTalent Grid can adjust them when reviewing.
        attendance_threshold_pct: 75,
        pass_mark_pct: 50,
        status: 'active' as const,
        approval_status: 'draft' as const,
        owner_organisation_id: org,
        created_by: req.actor!.userId,
      };
      await trx.insertInto('courses').values(row).execute();
      await trx.insertInto('course_review_events').values({ id: newId(), course_id: id, action: 'created', actor_id: req.actor!.userId }).execute();
      await audit(trx, auditCtx(req), { action: 'course.partner_created', entityType: 'course', entityId: id, after: row });
    });
    reply.code(201);
    return { id };
  });

  /** Saves any step. Only while the course is a draft or was sent back for changes. */
  app.patch('/partner/courses/:id', { config: { permission: 'course.author' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(partnerCourseSaveSchema, req.body);
    if (b.firstBatch) {
      const centres = await partnerCentres(db, req.actor!);
      if (!centres.includes(b.firstBatch.centreId)) throw invalid('Choose one of your centres', { 'firstBatch.centreId': 'Not one of your centres' });
    }
    return db.transaction().execute(async (trx) => {
      const c = await loadOwn(trx, req, id, { forUpdate: true });
      assertEditable(c);
      const changes = toRow(b);
      if (!Object.keys(changes).length) return { id };
      await trx.updateTable('courses').set({ ...changes, updated_at: new Date() }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'course.partner_updated', entityType: 'course', entityId: id, after: changes });
      return { id };
    });
  });

  /** Course picture: JPG or PNG, at most 2 MB. */
  app.post('/partner/courses/:id/image', { config: { permission: 'course.author' }, bodyLimit: COURSE_IMAGE_MAX_BYTES }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw invalid('Choose an image to upload', { image: 'No file received' });
    if (body.length > COURSE_IMAGE_MAX_BYTES) throw invalid('The image must be 2 MB or smaller', { image: 'Larger than 2 MB' });
    const mime = sniffMime(body);
    if (mime !== 'image/png' && mime !== 'image/jpeg') throw invalid('Upload a JPG or PNG image', { image: 'Only JPG or PNG' });
    const c = await loadOwn(db, req, id);
    assertEditable(c);
    const key = `course-images/${id}/${newId()}`;
    await app.storage.put(key, body);
    try {
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('courses').set({ image_key: key, image_mime: mime, updated_at: new Date() }).where('id', '=', id).execute();
        await audit(trx, auditCtx(req), { action: 'course.image_uploaded', entityType: 'course', entityId: id, after: { mime_type: mime, size_bytes: body.length } });
      });
    } catch (e) {
      await app.storage.delete(key);
      throw e;
    }
    if (c.image_key) await app.storage.delete(c.image_key).catch(() => undefined);
    const fresh = await db.selectFrom('courses').select(['id', 'image_key', 'updated_at']).where('id', '=', id).executeTakeFirstOrThrow();
    return { imageUrl: courseImageUrl(fresh) };
  });

  /** A draft that was never sent can be thrown away. */
  app.delete('/partner/courses/:id', { config: { permission: 'course.author' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await loadOwn(db, req, id);
    if (c.approval_status !== 'draft' || c.submitted_at) throw invalid('Only a draft that was never submitted can be deleted.');
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('course_review_events').where('course_id', '=', id).execute();
      await trx.deleteFrom('assessment_criteria').where('course_id', '=', id).execute();
      await trx.deleteFrom('courses').where('id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'course.partner_deleted', entityType: 'course', entityId: id, before: { title: c.title } });
    });
    if (c.image_key) await app.storage.delete(c.image_key).catch(() => undefined);
    return { ok: true };
  });

  /** Step 4: send the course to AutoTalent Grid. Everything the learner will see must be filled in. */
  app.post('/partner/courses/:id/submit', { config: { permission: 'course.author' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const centres = await partnerCentres(db, req.actor!);
    return db.transaction().execute(async (trx) => {
      const c = await loadOwn(trx, req, id, { forUpdate: true });
      assertEditable(c);
      const missing = await missingForSubmit(trx, c, centres);
      if (Object.keys(missing).length) throw invalid('Complete the highlighted details before submitting.', missing);
      const resubmit = c.approval_status === 'changes_requested';
      const now = new Date();
      await trx.updateTable('courses').set({ approval_status: 'submitted', submitted_at: now, updated_at: now }).where('id', '=', id).execute();
      await trx
        .insertInto('course_review_events')
        .values({ id: newId(), course_id: id, action: 'submitted', note: resubmit ? 'Resubmitted after changes' : null, actor_id: req.actor!.userId })
        .execute();
      await audit(trx, auditCtx(req), { action: 'course.submitted', entityType: 'course', entityId: id, before: { approval_status: c.approval_status }, after: { approval_status: 'submitted' } });
      const org = await trx.selectFrom('organisations').select('legal_name').where('id', '=', c.owner_organisation_id!).executeTakeFirstOrThrow();
      await notify(trx, await vtaReviewers(trx), 'course_submitted', { course: c.title, partner: org.legal_name }, `/admin/course-approvals/${id}`);
      return { id, approvalStatus: 'submitted' as const };
    });
  });

  // ------------------------------------------------------------------ AutoTalent Grid review (screen 7)

  app.get('/admin/course-reviews', { config: { permission: 'course.review' } }, async (req) => {
    const f = parse(listQuerySchema.extend({ approvalStatus: z.enum(COURSE_APPROVAL_STATUSES).optional() }), req.query);
    let q = db
      .selectFrom('courses as c')
      .innerJoin('organisations as o', 'o.id', 'c.owner_organisation_id')
      .where('c.approval_status', '<>', 'draft');
    const counts = await q.select(['c.approval_status', sql<string>`count(*)`.as('n')]).groupBy('c.approval_status').execute();
    if (f.approvalStatus) q = q.where('c.approval_status', '=', f.approvalStatus);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('c.title', 'ilike', like), eb('o.legal_name', 'ilike', like)]));
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .selectAll('c')
      .select('o.legal_name as owner_name')
      .orderBy(sql`case c.approval_status when 'submitted' then 0 when 'changes_requested' then 1 else 2 end`)
      .orderBy('c.submitted_at', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return {
      items: rows.map((r) => toDto(r)),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
      counts: Object.fromEntries(counts.map((r) => [r.approval_status, Number(r.n)])),
    };
  });

  app.get('/admin/course-reviews/:id', { config: { permission: 'course.review' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await db
      .selectFrom('courses as c')
      .innerJoin('organisations as o', 'o.id', 'c.owner_organisation_id')
      .selectAll('c')
      .select(['o.legal_name as owner_name'])
      .where('c.id', '=', id)
      .executeTakeFirst();
    if (!c || c.approval_status === 'draft') throw notFound('Course');
    const org = await db
      .selectFrom('organisations')
      .selectAll()
      .where('id', '=', c.owner_organisation_id!)
      .executeTakeFirstOrThrow();
    const centreRows = await db.selectFrom('centres').select(['name', 'city', 'status']).where('organisation_id', '=', org.id).orderBy('name').execute();
    const stats = await db
      .selectFrom('courses')
      .select(['approval_status', sql<string>`count(*)`.as('n')])
      .where('owner_organisation_id', '=', org.id)
      .groupBy('approval_status')
      .execute();
    return {
      ...toDto(c, await firstBatchNames(db, c.first_batch)),
      history: await history(db, id),
      batches: await courseBatches(db, id),
      partner: {
        id: org.id,
        name: org.legal_name,
        verificationStatus: org.verification_status,
        type: org.partner_subtype,
        city: org.city,
        contactName: org.contact_name,
        email: org.contact_email,
        phone: org.contact_phone,
        website: org.website,
        centres: centreRows,
        publishedCourses: Number(stats.find((s) => s.approval_status === 'published')?.n ?? 0),
      },
    };
  });

  const RULES = {
    publish: { from: ['submitted'], to: 'published', event: 'published', tpl: 'course_published' },
    request_changes: { from: ['submitted'], to: 'changes_requested', event: 'changes_requested', tpl: 'course_changes_requested' },
    reject: { from: ['submitted', 'changes_requested'], to: 'rejected', event: 'rejected', tpl: 'course_rejected' },
  } as const;

  app.post('/admin/course-reviews/:id/decision', { config: { permission: 'course.review' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(courseReviewSchema, req.body);
    const rule = RULES[b.action];
    const result = await db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('courses').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!c || !c.owner_organisation_id || c.approval_status === 'draft') throw notFound('Course');
      if (!(rule.from as readonly string[]).includes(c.approval_status)) {
        throw invalid(`This course is ${c.approval_status.replace('_', ' ')}, so it cannot be ${b.action === 'publish' ? 'published' : b.action === 'reject' ? 'rejected' : 'sent back'} now.`);
      }
      if (b.action === 'publish') {
        const org = await trx.selectFrom('organisations').select('verification_status').where('id', '=', c.owner_organisation_id).executeTakeFirstOrThrow();
        if (org.verification_status !== 'verified') throw invalid('Verify this training partner before publishing its courses.');
      }
      const now = new Date();
      await trx
        .updateTable('courses')
        .set({
          approval_status: rule.to,
          review_note: b.note || null,
          reviewed_at: now,
          reviewed_by: req.actor!.userId,
          updated_at: now,
          ...(b.action === 'publish' && { published_at: c.published_at ?? now, status: 'active' as const }),
        })
        .where('id', '=', id)
        .execute();
      await trx.insertInto('course_review_events').values({ id: newId(), course_id: id, action: rule.event, note: b.note || null, actor_id: req.actor!.userId }).execute();

      let batchId: string | null = null;
      let batchProblem: string | null = null;
      if (b.action === 'publish') {
        // The trainer assesses each module: they become the course's assessment criteria.
        const hasCriteria = await trx.selectFrom('assessment_criteria').select('id').where('course_id', '=', id).executeTakeFirst();
        if (!hasCriteria && c.modules.length) {
          await trx
            .insertInto('assessment_criteria')
            .values(c.modules.map((m, i) => ({ id: newId(), course_id: id, label: m.name, max_score: 100, required: true, sort_order: i })))
            .execute();
        }
        // The partner's planned first batch becomes a real batch, open for enrolment.
        const r = await createFirstBatch(trx, req, c);
        batchId = r.batchId;
        batchProblem = r.problem;
      }
      await audit(trx, auditCtx(req), {
        action: `course.review.${b.action}`,
        entityType: 'course',
        entityId: id,
        before: { approval_status: c.approval_status },
        after: { approval_status: rule.to, note: b.note ?? null, ...(batchId && { first_batch_id: batchId }) },
      });
      await notify(
        trx,
        await orgMembers(trx, c.owner_organisation_id, PARTNER_TEAM),
        rule.tpl,
        { course: c.title, reason: b.note ?? (batchProblem ? `The first batch was not created: ${batchProblem}` : '') },
        `/partner/courses/${id}`,
      );
      return { approvalStatus: rule.to, batchId, batchProblem };
    });
    return { id, ...result };
  });

  /** Makes the planned first batch real. A problem (for example the trainer is no longer verified) is reported, not fatal. */
  async function createFirstBatch(trx: Transaction<Database>, req: FastifyRequest, c: Course): Promise<{ batchId: string | null; problem: string | null }> {
    const fb = c.first_batch;
    if (!fb) return { batchId: null, problem: null };
    const exists = await trx.selectFrom('batches').select('id').where('course_id', '=', c.id).executeTakeFirst();
    if (exists) return { batchId: null, problem: null };
    const centre = await trx.selectFrom('centres').select(['status', 'organisation_id']).where('id', '=', fb.centreId).executeTakeFirst();
    if (!centre || centre.status !== 'active' || centre.organisation_id !== c.owner_organisation_id) return { batchId: null, problem: 'the centre is no longer active.' };
    if (fb.startDate < todayIst()) return { batchId: null, problem: 'its start date has passed. Create a new batch from Course management.' };
    let grant: boolean;
    try {
      grant = await assertTrainerFits(trx, fb.trainerId, fb.centreId);
    } catch (e) {
      if (e instanceof ApiError) return { batchId: null, problem: `${e.message}.` };
      throw e;
    }
    const row = {
      id: newId(),
      name: fb.name,
      course_id: c.id,
      centre_id: fb.centreId,
      trainer_id: fb.trainerId,
      start_date: fb.startDate,
      end_date: fb.endDate,
      capacity: fb.capacity,
      class_timings: fb.classTimings,
      status: 'planned' as const,
      created_by: c.created_by,
    };
    if (grant) await grantRole(trx, req, { userId: fb.trainerId, role: 'trainer', centreId: fb.centreId });
    await trx.insertInto('batches').values(row).execute();
    await audit(trx, auditCtx(req), { action: 'batch.created', entityType: 'batch', entityId: row.id, after: { ...row, from_course_review: true } });
    await notify(trx, [row.trainer_id], 'batch_assigned', { batch: row.name, course: c.title, start: formatDay(row.start_date) }, `/partner/batches/${row.id}`);
    return { batchId: row.id, problem: null };
  }

  /** Unpublish / publish again: hides or shows a published partner course for learners without a new review. */
  for (const [path, status, event] of [['unpublish', 'inactive', 'unpublished'], ['republish', 'active', 'republished']] as const) {
    app.post(`/admin/course-reviews/:id/${path}`, { config: { permission: 'course.review' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }), req.body ?? {});
      await db.transaction().execute(async (trx) => {
        const c = await trx.selectFrom('courses').select(['approval_status', 'status', 'owner_organisation_id']).where('id', '=', id).forUpdate().executeTakeFirst();
        if (!c || !c.owner_organisation_id || c.approval_status !== 'published') throw notFound('Course');
        if (c.status === status) throw invalid(path === 'unpublish' ? 'This course is already hidden from learners.' : 'This course is already visible to learners.');
        await trx.updateTable('courses').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
        await trx.insertInto('course_review_events').values({ id: newId(), course_id: id, action: event, note: note || null, actor_id: req.actor!.userId }).execute();
        await audit(trx, auditCtx(req), { action: `course.${event}`, entityType: 'course', entityId: id, before: { status: c.status }, after: { status } });
      });
      return { id, active: status === 'active' };
    });
  }
};

