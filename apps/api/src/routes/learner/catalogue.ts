import {
  catalogueQuerySchema,
  selfEnrolSchema,
  uuidSchema,
  type CatalogueBatch,
  type CatalogueCourse,
  type CatalogueCourseDetail,
  type DurationBucket,
  type FeeBucket,
} from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import type { Course } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { formatDay, todayIst } from '../../lib/dates.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { iso, parse } from '../../lib/validate.js';
import { consentRequired } from './service.js';

/**
 * Phase 13: the public course catalogue and learner self-enrolment.
 * Public: active courses with batches that have not started and still have seats, and which centre runs them.
 * Nothing about people is shown (no trainer or learner names). Learners enrol themselves; a fee is paid online
 * (a marked test payment on staging, PAYMENT_MODE) and the seat is confirmed at once while the batch has room.
 */
const idParam = z.object({ id: uuidSchema });
const rupees = (paise: number) => Math.round(paise / 100);
const money = (paise: number) => `₹${rupees(paise).toLocaleString('en-IN')}`;

/** Batches open for enrolment: planned or active, not started yet (India time). */
function openBatches(db: DB) {
  return db
    .selectFrom('batches as b')
    .innerJoin('centres as c', 'c.id', 'b.centre_id')
    .leftJoin('organisations as o', 'o.id', 'c.organisation_id')
    .select([
      'b.id',
      'b.name',
      'b.course_id',
      'b.start_date',
      'b.end_date',
      'b.capacity',
      'c.name as centre',
      'c.city',
      'c.address',
      'o.legal_name as org',
      'o.type as org_type',
      sql<string>`(select count(*) from enrolments e where e.batch_id = b.id and e.status <> 'withdrawn')`.as('taken'),
    ])
    .where('b.status', 'in', ['planned', 'active'])
    .where('b.start_date', '>=', todayIst())
    .where('c.status', '=', 'active');
}

type BatchRow = Awaited<ReturnType<ReturnType<typeof openBatches>['execute']>>[number];

const batchDto = (b: BatchRow): CatalogueBatch => ({
  id: b.id,
  name: b.name,
  startDate: b.start_date,
  endDate: b.end_date,
  centre: b.centre,
  // The training provider is the centre's organisation; AutoTalent Grid's own centres show as AutoTalent Grid.
  provider: b.org && b.org_type !== 'vta' ? b.org : 'AutoTalent Grid',
  city: b.city,
  address: b.address,
  capacity: b.capacity,
  seatsLeft: Math.max(0, b.capacity - Number(b.taken)),
});

function durationDays(c: Pick<Course, 'duration_value' | 'duration_unit'>): number {
  return c.duration_value * (c.duration_unit === 'days' ? 1 : c.duration_unit === 'weeks' ? 7 : 30);
}
function durationBucket(c: Pick<Course, 'duration_value' | 'duration_unit'>): DurationBucket {
  const d = durationDays(c);
  return d < 7 ? 'lt1w' : d <= 28 ? '1to4w' : d <= 92 ? '1to3m' : 'gt3m';
}
function feeBucket(paise: number): FeeBucket {
  const r = rupees(paise);
  return r === 0 ? 'free' : r <= 5000 ? 'upto5k' : r <= 20000 ? '5kto20k' : 'over20k';
}

function courseDto(c: Course, batches: CatalogueBatch[]): CatalogueCourse {
  const sorted = [...batches].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return {
    // nextStart is '' when no batch is open.
    id: c.id,
    title: c.title,
    code: c.code,
    skillArea: c.skill_area,
    level: c.level,
    deliveryMode: c.delivery_mode,
    durationValue: c.duration_value,
    durationUnit: c.duration_unit,
    trainingHours: c.training_hours,
    feeRupees: rupees(c.fee_paise),
    providers: [...new Set(sorted.map((b) => b.provider))],
    cities: [...new Set(sorted.map((b) => b.city).filter((x): x is string => !!x))],
    nextStart: sorted[0]?.startDate ?? '',
    batchCount: sorted.length,
  };
}

export const catalogueRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const publicCfg = { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } };

  app.get('/public/courses', { config: publicCfg }, async (req) => {
    const f = parse(catalogueQuerySchema, req.query);
    const courses = await db.selectFrom('courses').selectAll().where('status', '=', 'active').execute();
    const batches = (await openBatches(db).execute()).map((b) => ({ courseId: b.course_id, dto: batchDto(b) }));
    const cities = [...new Set(batches.map((b) => b.dto.city).filter((x): x is string => !!x))].sort();
    let items = courses
      .map((c) => {
        const mine = batches.filter((b) => b.courseId === c.id && (!f.city || b.dto.city === f.city)).map((b) => b.dto);
        return mine.length ? { c, dto: courseDto(c, mine) } : null;
      })
      .filter((x): x is { c: Course; dto: CatalogueCourse } => !!x);
    if (f.skill.length) items = items.filter((i) => (f.skill as string[]).includes(i.c.skill_area));
    if (f.mode.length) items = items.filter((i) => (f.mode as string[]).includes(i.c.delivery_mode));
    if (f.duration.length) items = items.filter((i) => f.duration.includes(durationBucket(i.c)));
    if (f.fee.length) items = items.filter((i) => f.fee.includes(feeBucket(i.c.fee_paise)));
    if (f.q) {
      const q = f.q.toLowerCase();
      items = items.filter((i) => i.c.title.toLowerCase().includes(q) || (i.c.code ?? '').toLowerCase().includes(q));
    }
    items.sort((a, b) =>
      f.sort === 'fee_asc' ? a.c.fee_paise - b.c.fee_paise : f.sort === 'fee_desc' ? b.c.fee_paise - a.c.fee_paise : a.dto.nextStart.localeCompare(b.dto.nextStart) || a.c.title.localeCompare(b.c.title),
    );
    return { items: items.map((i) => i.dto), total: items.length, cities };
  });

  app.get('/public/courses/:id', { config: publicCfg }, async (req): Promise<CatalogueCourseDetail> => {
    const { id } = parse(idParam, req.params);
    const c = await db.selectFrom('courses').selectAll().where('id', '=', id).where('status', '=', 'active').executeTakeFirst();
    if (!c) throw notFound('Course');
    const batches = (await openBatches(db).where('b.course_id', '=', id).orderBy('b.start_date').execute()).map(batchDto);
    const skills = await db.selectFrom('assessment_criteria').select(['label', 'required']).where('course_id', '=', id).orderBy('sort_order').execute();
    return {
      ...courseDto(c, batches),
      description: c.description,
      prerequisites: c.prerequisites,
      attendanceThresholdPct: c.attendance_threshold_pct,
      passMarkPct: c.pass_mark_pct,
      skills: skills.map((s) => ({ label: s.label, required: s.required })),
      batches,
    };
  });

  // ---------------------------------------------------------------- learner self-enrolment

  /** Why this learner cannot enrol in this batch, or null. Checked again, with the batch locked, when enrolling. */
  async function blocker(trx: DB, userId: string, batch: { id: string; capacity: number; status: string; start_date: string }): Promise<string | null> {
    const p = await trx
      .selectFrom('candidate_profiles as cp')
      .innerJoin('users as u', 'u.id', 'cp.user_id')
      .select(['u.status', 'cp.verification_status', 'cp.duplicate_of'])
      .where('cp.user_id', '=', userId)
      .executeTakeFirst();
    if (!p) return 'Only learner accounts can enrol.';
    if (await consentRequired(trx, userId)) return 'Accept the privacy notice and terms of use first (in Privacy).';
    if (p.status !== 'active') return 'Your account is not active. Contact AutoTalent Grid.';
    if (p.verification_status === 'rejected' || p.verification_status === 'needs_correction') return 'Correct your profile first: AutoTalent Grid asked for changes.';
    if (p.duplicate_of) return 'AutoTalent Grid is checking your profile. Try again later or contact your centre.';
    if (!(batch.status === 'planned' || batch.status === 'active') || batch.start_date < todayIst()) return 'This batch is no longer open for enrolment.';
    const mine = await trx.selectFrom('enrolments').select('id').where('batch_id', '=', batch.id).where('candidate_id', '=', userId).where('status', '!=', 'withdrawn').executeTakeFirst();
    if (mine) return 'You are already enrolled in this batch.';
    const { n } = await trx.selectFrom('enrolments').select(sql<string>`count(*)`.as('n')).where('batch_id', '=', batch.id).where('status', '!=', 'withdrawn').executeTakeFirstOrThrow();
    if (Number(n) >= batch.capacity) return 'This batch is full. Choose another batch.';
    return null;
  }

  const batchSummary = (trx: DB, batchId: string) =>
    trx
      .selectFrom('batches as b')
      .innerJoin('courses as co', 'co.id', 'b.course_id')
      .innerJoin('centres as c', 'c.id', 'b.centre_id')
      .leftJoin('organisations as o', 'o.id', 'c.organisation_id')
      .select([
        'b.id',
        'b.name',
        'b.status',
        'b.capacity',
        'b.start_date',
        'b.end_date',
        'b.centre_id',
        'co.id as course_id',
        'co.title',
        'co.skill_area',
        'co.delivery_mode',
        'co.duration_value',
        'co.duration_unit',
        'co.fee_paise',
        'co.status as course_status',
        'c.name as centre',
        'c.city',
        'o.legal_name as org',
        'o.type as org_type',
      ])
      .where('b.id', '=', batchId)
      .executeTakeFirst();

  /** What the learner will enrol in and pay, and whether they can. */
  app.get('/me/enrol/:id', { config: { permission: 'learner.self' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = await batchSummary(db, id);
    if (!b || b.course_status !== 'active') throw notFound('Batch');
    const { n } = await db.selectFrom('enrolments').select(sql<string>`count(*)`.as('n')).where('batch_id', '=', id).where('status', '!=', 'withdrawn').executeTakeFirstOrThrow();
    return {
      batch: { id: b.id, name: b.name, startDate: b.start_date, endDate: b.end_date, centre: b.centre, city: b.city, provider: b.org && b.org_type !== 'vta' ? b.org : 'AutoTalent Grid', seatsLeft: Math.max(0, b.capacity - Number(n)) },
      course: { id: b.course_id, title: b.title, skillArea: b.skill_area, deliveryMode: b.delivery_mode, durationValue: b.duration_value, durationUnit: b.duration_unit, feeRupees: rupees(b.fee_paise) },
      blocker: await blocker(db, req.actor!.userId, b),
      paymentMode: app.config.paymentMode,
    };
  });

  app.post('/me/enrolments', { config: { permission: 'learner.self' } }, async (req, reply) => {
    const body = parse(selfEnrolSchema, req.body);
    const userId = req.actor!.userId;
    const result = await db.transaction().execute(async (trx) => {
      // Lock the batch so two learners cannot take the last seat at the same time.
      const locked = await trx.selectFrom('batches').select(['id', 'capacity', 'status', 'start_date']).where('id', '=', body.batchId).forUpdate().executeTakeFirst();
      const b = locked ? await batchSummary(trx, body.batchId) : undefined;
      if (!locked || !b || b.course_status !== 'active') throw notFound('Batch');
      const why = await blocker(trx, userId, locked);
      if (why) throw conflict(why);
      const fee = b.fee_paise;
      if (fee > 0 && !body.method) throw invalid('Choose how to pay', { method: 'Choose how to pay' });
      if (fee > 0 && app.config.paymentMode !== 'test') throw conflict('Online payment is not set up yet. Contact the training centre to enrol.');

      const prior = await trx.selectFrom('enrolments').select('id').where('batch_id', '=', b.id).where('candidate_id', '=', userId).executeTakeFirst();
      const enrolmentId = prior?.id ?? newId();
      if (prior) {
        await trx
          .updateTable('enrolments')
          .set({ status: 'enrolled', enrolled_at: new Date(), enrolled_by: userId, withdrawn_at: null, withdraw_reason: null, source: 'self', updated_at: new Date() })
          .where('id', '=', prior.id)
          .execute();
      } else {
        await trx.insertInto('enrolments').values({ id: enrolmentId, candidate_id: userId, batch_id: b.id, status: 'enrolled', enrolled_by: userId, source: 'self' }).execute();
      }
      const seq = (await sql<{ n: string }>`SELECT nextval('enrolment_receipt_seq') AS n`.execute(trx)).rows[0]!.n;
      const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
      const receipt = `ATG-ENR-${day}-${String(seq).padStart(4, '0')}`;
      const paymentId = newId();
      await trx
        .insertInto('course_payments')
        .values({ id: paymentId, enrolment_id: enrolmentId, candidate_id: userId, batch_id: b.id, amount_paise: fee, method: fee > 0 ? body.method! : null, provider: fee > 0 ? 'test' : 'free', status: 'succeeded', receipt_number: receipt })
        .execute();
      await audit(trx, auditCtx(req), {
        action: 'enrolment.self',
        entityType: 'batch',
        entityId: b.id,
        after: { candidateId: userId, enrolmentId, amount_paise: fee, receipt, test: fee > 0 },
      });
      const learner = await trx.selectFrom('users').select('name').where('id', '=', userId).executeTakeFirstOrThrow();
      const centreAdmins = await trx
        .selectFrom('role_assignments as ra')
        .innerJoin('users as u', 'u.id', 'ra.user_id')
        .select('u.id')
        .where('ra.role', '=', 'centre_admin')
        .where('ra.centre_id', '=', b.centre_id)
        .where('ra.revoked_at', 'is', null)
        .where('u.status', '=', 'active')
        .execute();
      await notify(trx, centreAdmins.map((r) => r.id), 'self_enrolled', { learner: learner.name, batch: b.name, amount: fee > 0 ? money(fee) : '' }, `/admin/batches/${b.id}`);
      return { enrolmentId, receiptNumber: receipt };
    });
    reply.code(201);
    return result;
  });

  /** The learner's enrolment confirmation and receipt. */
  app.get('/me/enrolments/:id/receipt', { config: { permission: 'learner.self' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await db
      .selectFrom('course_payments as p')
      .innerJoin('enrolments as e', 'e.id', 'p.enrolment_id')
      .innerJoin('users as u', 'u.id', 'p.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'p.candidate_id')
      .select(['p.id', 'p.amount_paise', 'p.method', 'p.provider', 'p.receipt_number', 'p.created_at', 'e.status', 'u.name', 'cp.candidate_code', 'p.batch_id'])
      .where('p.enrolment_id', '=', id)
      .where('p.candidate_id', '=', req.actor!.userId)
      .orderBy('p.created_at', 'desc')
      .executeTakeFirst();
    if (!r) throw notFound('Receipt');
    const b = (await batchSummary(db, r.batch_id))!;
    return {
      enrolmentId: id,
      receiptNumber: r.receipt_number,
      amountRupees: rupees(r.amount_paise),
      method: r.method,
      test: r.provider === 'test',
      free: r.provider === 'free',
      paidAt: iso(r.created_at),
      status: r.status,
      learner: { name: r.name, code: r.candidate_code },
      course: { title: b.title, deliveryMode: b.delivery_mode, durationValue: b.duration_value, durationUnit: b.duration_unit },
      batch: { name: b.name, startDate: b.start_date, endDate: b.end_date, startLabel: formatDay(b.start_date), centre: b.centre, city: b.city, provider: b.org && b.org_type !== 'vta' ? b.org : 'AutoTalent Grid' },
    };
  });
};
