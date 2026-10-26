import { COURSE_LEVELS, courseSchema, criteriaListSchema, criterionSchema, listQuerySchema, SKILL_AREAS, uuidSchema, type Page } from '@vta/shared';
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

const idParam = z.object({ id: uuidSchema });

export function courseDto(c: Course & { criteria_count?: string | number; batch_count?: string | number }) {
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
    feeRupees: Math.round(c.fee_paise / 100),
    status: c.status,
    criteriaCount: c.criteria_count !== undefined ? Number(c.criteria_count) : undefined,
    batchCount: c.batch_count !== undefined ? Number(c.batch_count) : undefined,
    createdAt: iso(c.created_at),
  };
}

const courseFilter = listQuerySchema.extend({
  skillArea: z.enum(SKILL_AREAS).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

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
    let q = db.selectFrom('courses as c');
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
    const c = await db.selectFrom('courses').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c) throw notFound('Course');
    return { ...courseDto(c), criteria: await loadCriteria(db, id), criteriaLocked: await criteriaLocked(db, id) };
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
      const c = await db.selectFrom('courses').select(['status']).where('id', '=', id).executeTakeFirst();
      if (!c) throw notFound('Course');
      if (c.status === status) throw invalid(`This course is already ${status}.`);
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
  };
}
