import { COURSE_APPROVAL_STATUSES, COURSE_LEVELS, courseSchema, feeWithGst, criteriaListSchema, criterionSchema, listQuerySchema, SKILL_AREAS, uuidSchema, type Page } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import type { Course } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { iso, parse } from '../../lib/validate.js';
import { courseReadScope, courseVisible, type CourseScope } from '../../policy/index.js';

const idParam = z.object({ id: uuidSchema });

/**
 * AutoTalent Grid career journey courses that have a ready-made picture in the web app (29 Oct 2026). An image
 * uploaded later replaces it.
 */
const JOURNEY_PICTURES = new Set(['ATG-TECH-1', 'ATG-TECH-2', 'ATG-TECH-3', 'ATG-PARTS-1', 'ATG-PARTS-2', 'ATG-PARTS-3', 'ATG-TECH-4', 'ATG-SA-1', 'ATG-SA-2', 'ATG-SA-3', 'ATG-FS-1', 'ATG-FS-2', 'ATG-FS-3', 'ATG-FS-4']);

/** Where the browser loads a course picture from (cache-busted by the last change). */
export function courseImageUrl(c: Pick<Course, 'id' | 'image_key' | 'updated_at'> & { code?: string | null }, publicRoute = false): string | null {
  if (!c.image_key) return c.code && JOURNEY_PICTURES.has(c.code) ? `/courses/journeys/${c.code}.webp` : null;
  const v = new Date(c.updated_at).getTime().toString(36);
  return publicRoute ? `/api/v1/public/courses/${c.id}/image?v=${v}` : `/api/v1/courses/${c.id}/image?v=${v}`;
}

export function courseDto(c: Course & { criteria_count?: string | number; batch_count?: string | number; owner_name?: string | null }) {
  const fee = Math.round(c.fee_paise / 100);
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    skillArea: c.skill_area,
    level: c.level,
    deliveryMode: c.delivery_mode,
    durationValue: c.duration_value,
    durationUnit: c.duration_unit,
    trainingHours: c.training_hours,
    prerequisites: c.prerequisites,
    description: c.description,
    attendanceThresholdPct: c.attendance_threshold_pct,
    passMarkPct: c.pass_mark_pct,
    feeRupees: fee,
    gstPct: c.gst_pct,
    totalFeeRupees: feeWithGst(fee, c.gst_pct).totalRupees,
    stayAvailable: c.stay_available,
    stayFeeRupees: c.stay_fee_paise === null ? null : Math.round(c.stay_fee_paise / 100),
    stayMeals: c.stay_meals,
    track: c.track,
    trackStep: c.track_step,
    status: c.status,
    approvalStatus: c.approval_status,
    owner: c.owner_organisation_id ? { id: c.owner_organisation_id, name: c.owner_name ?? '' } : null,
    courseType: c.course_type,
    city: c.city,
    certificateType: c.certificate_type,
    modules: c.modules,
    skills: c.skills,
    learningOutcomes: c.learning_outcomes,
    imageUrl: courseImageUrl(c),
    criteriaCount: c.criteria_count !== undefined ? Number(c.criteria_count) : undefined,
    batchCount: c.batch_count !== undefined ? Number(c.batch_count) : undefined,
    createdAt: iso(c.created_at),
  };
}

const courseFilter = listQuerySchema.extend({
  skillArea: z.enum(SKILL_AREAS).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  approvalStatus: z.enum(COURSE_APPROVAL_STATUSES).optional(),
  /** Only courses a batch can be created for right now: published and active. */
  bookable: z.coerce.boolean().optional(),
});

/** Applies the actor's course read scope to a query on `courses as c`. */
function scopedCourses<Q extends { where: (...args: any[]) => Q }>(q: Q, scope: CourseScope): Q {
  if (scope === 'admin') return q.where((eb: any) => eb.or([eb('c.approval_status', '<>', 'draft'), eb('c.owner_organisation_id', 'is', null)]));
  return q.where((eb: any) =>
    eb.or([eb('c.approval_status', '=', 'published'), ...(scope.ownOrgIds.length ? [eb('c.owner_organisation_id', 'in', scope.ownOrgIds)] : [])]),
  );
}

const createSchema = courseSchema.extend({ criteria: z.array(criterionSchema).min(1, 'Add at least one assessment criterion').max(40) });

async function loadCriteria(db: DB, courseId: string) {
  const rows = await db.selectFrom('assessment_criteria').selectAll().where('course_id', '=', courseId).orderBy('sort_order').execute();
  return rows.map((r) => ({ id: r.id, label: r.label, maxScore: r.max_score, required: r.required }));
}

/** Criteria are locked once a batch of this course has started: results would no longer match them. */
async function criteriaLocked(db: DB, courseId: string): Promise<boolean> {
  const started = await db.selectFrom('batches').select('id').where('course_id', '=', courseId).where('status', 'in', ['active', 'completed']).executeTakeFirst();
  return !!started;
}

function toRow(b: z.infer<typeof courseSchema>) {
  return {
    code: b.code ?? null,
    title: b.title,
    skill_area: b.skillArea,
    level: b.level,
    delivery_mode: b.deliveryMode,
    duration_value: b.durationValue,
    duration_unit: b.durationUnit,
    training_hours: b.trainingHours ?? null,
    prerequisites: b.prerequisites || null,
    description: b.description || null,
    attendance_threshold_pct: b.attendanceThresholdPct,
    pass_mark_pct: b.passMarkPct,
    fee_paise: (b.feeRupees ?? 0) * 100,
    gst_pct: b.gstPct ?? 0,
    stay_available: b.stayAvailable ?? false,
    stay_fee_paise: b.stayAvailable && b.stayFeeRupees != null ? b.stayFeeRupees * 100 : null,
    stay_meals: b.stayMeals ?? 1,
  };
}

const uniqueCode = (e: unknown) => {
  if ((e as { code?: string; constraint?: string }).code === '23505') throw conflict('Another course already uses this code', { code: 'Already in use' });
  throw e;
};

export const courseRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  /** Course catalogue, visible to all training staff. */
  app.get('/courses', { config: { permission: 'course.read' } }, async (req): Promise<Page<ReturnType<typeof courseDto>>> => {
    const f = parse(courseFilter, req.query);
    let q = scopedCourses(db.selectFrom('courses as c').leftJoin('organisations as o', 'o.id', 'c.owner_organisation_id'), courseReadScope(req.actor!));
    if (f.approvalStatus) q = q.where('c.approval_status', '=', f.approvalStatus);
    if (f.bookable) q = q.where('c.approval_status', '=', 'published').where('c.status', '=', 'active');
    if (f.skillArea) q = q.where('c.skill_area', '=', f.skillArea);
    if (f.level) q = q.where('c.level', '=', f.level);
    if (f.status) q = q.where('c.status', '=', f.status);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('c.title', 'ilike', like), eb('c.code', 'ilike', like)]));
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .selectAll('c')
      .select([
        'o.legal_name as owner_name',
        sql<string>`(select count(*) from assessment_criteria a where a.course_id = c.id)`.as('criteria_count'),
        sql<string>`(select count(*) from batches b where b.course_id = c.id and b.status <> 'cancelled')`.as('batch_count'),
      ])
      .orderBy('c.status')
      .orderBy('c.title')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return { items: rows.map(courseDto), page: f.page, pageSize: f.pageSize, total: Number(total) };
  });

  app.get('/courses/:id', { config: { permission: 'course.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await db
      .selectFrom('courses as c')
      .leftJoin('organisations as o', 'o.id', 'c.owner_organisation_id')
      .selectAll('c')
      .select('o.legal_name as owner_name')
      .where('c.id', '=', id)
      .executeTakeFirst();
    if (!c || !courseVisible(courseReadScope(req.actor!), c)) throw notFound('Course');
    return { ...courseDto(c), criteria: await loadCriteria(db, id), criteriaLocked: await criteriaLocked(db, id) };
  });

  /** The course picture, for anyone who may read the course. */
  app.get('/courses/:id/image', { config: { permission: 'course.read' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const c = await db.selectFrom('courses').select(['image_key', 'image_mime', 'approval_status', 'owner_organisation_id']).where('id', '=', id).executeTakeFirst();
    if (!c || !c.image_key || !courseVisible(courseReadScope(req.actor!), c)) throw notFound('Image');
    const data = await app.storage.get(c.image_key);
    return reply.header('content-type', c.image_mime ?? 'image/jpeg').header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(data);
  });

  /** T-01: create a course with its assessment criteria in one step. */
  app.post('/admin/courses', { config: { permission: 'course.manage' } }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    const id = newId();
    await db
      .transaction()
      .execute(async (trx) => {
        const row = { id, ...toRow(b), status: 'active' as const };
        await trx.insertInto('courses').values(row).execute();
        await trx
          .insertInto('assessment_criteria')
          .values(b.criteria.map((c, i) => ({ id: newId(), course_id: id, label: c.label, max_score: c.maxScore, required: c.required, sort_order: i })))
          .execute();
        await audit(trx, auditCtx(req), { action: 'course.created', entityType: 'course', entityId: id, after: { ...row, criteria: b.criteria } });
      })
      .catch(uniqueCode);
    reply.code(201);
    return { id };
  });

  app.patch('/admin/courses/:id', { config: { permission: 'course.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(courseSchema.partial(), req.body);
    const before = await db.selectFrom('courses').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('Course');
    const full = toRow({ ...courseFromRow(before), ...b });
    const changes = Object.fromEntries(Object.entries(full).filter(([k, v]) => before[k as keyof Course] !== v));
    if (!Object.keys(changes).length) return { id };
    if (('attendance_threshold_pct' in changes || 'pass_mark_pct' in changes) && (await criteriaLocked(db, id))) {
      throw invalid('The pass rules cannot change after a batch of this course has started.');
    }
    await db
      .transaction()
      .execute(async (trx) => {
        await trx.updateTable('courses').set({ ...changes, updated_at: new Date() }).where('id', '=', id).execute();
        const prior = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k as keyof Course]]));
        await audit(trx, auditCtx(req), { action: 'course.updated', entityType: 'course', entityId: id, before: prior, after: changes });
      })
      .catch(uniqueCode);
    return { id };
  });

  /** Replaces the whole criteria list. Refused once a batch has started (results must keep matching). */
  app.put('/admin/courses/:id/criteria', { config: { permission: 'course.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { criteria } = parse(criteriaListSchema, req.body);
    const c = await db.selectFrom('courses').select('id').where('id', '=', id).executeTakeFirst();
    if (!c) throw notFound('Course');
    if (await criteriaLocked(db, id)) throw invalid('Assessment criteria cannot change after a batch of this course has started.');
    const before = await loadCriteria(db, id);
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('assessment_criteria').where('course_id', '=', id).execute();
      await trx
        .insertInto('assessment_criteria')
        .values(criteria.map((cr, i) => ({ id: newId(), course_id: id, label: cr.label, max_score: cr.maxScore, required: cr.required, sort_order: i })))
        .execute();
      await audit(trx, auditCtx(req), {
        action: 'course.criteria_replaced',
        entityType: 'course',
        entityId: id,
        before: { criteria: before.map(({ label, maxScore, required }) => ({ label, maxScore, required })) },
        after: { criteria },
      });
    });
    return { id, criteria: await loadCriteria(db, id) };
  });

  for (const [path, status] of [['deactivate', 'inactive'], ['activate', 'active']] as const) {
    app.post(`/admin/courses/:id/${path}`, { config: { permission: 'course.manage' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const c = await db.selectFrom('courses').select(['status', 'track', 'fee_paise']).where('id', '=', id).executeTakeFirst();
      if (!c) throw notFound('Course');
      if (c.status === status) throw invalid(`This course is already ${status}.`);
      // A career journey course is paid for when enrolling: it cannot go live without a fee.
      if (status === 'active' && c.track && c.fee_paise <= 0) throw invalid('Set the course fee before switching this course on.', { feeRupees: 'Enter the course fee' });
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('courses').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
        await audit(trx, auditCtx(req), { action: `course.${path}d`, entityType: 'course', entityId: id, before: { status: c.status }, after: { status } });
      });
      return { id, status };
    });
  }
};

function courseFromRow(c: Course): z.infer<typeof courseSchema> {
  return {
    code: c.code ?? undefined,
    title: c.title,
    skillArea: c.skill_area,
    level: c.level as z.infer<typeof courseSchema>['level'],
    deliveryMode: c.delivery_mode as z.infer<typeof courseSchema>['deliveryMode'],
    durationValue: c.duration_value,
    durationUnit: c.duration_unit as z.infer<typeof courseSchema>['durationUnit'],
    trainingHours: c.training_hours ?? undefined,
    prerequisites: c.prerequisites ?? undefined,
    description: c.description ?? undefined,
    attendanceThresholdPct: c.attendance_threshold_pct,
    passMarkPct: c.pass_mark_pct,
    feeRupees: Math.round(c.fee_paise / 100),
    gstPct: c.gst_pct,
    stayAvailable: c.stay_available,
    stayFeeRupees: c.stay_fee_paise === null ? null : Math.round(c.stay_fee_paise / 100),
    stayMeals: c.stay_meals,
  };
}
