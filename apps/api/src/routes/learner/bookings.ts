import { assignBookingSchema, BOOKING_STATUSES, courseBookingSchema, uuidSchema, type JourneyInfo, type Track, type TrackStep } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit, type AuditContext } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import type { Course } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { formatDay, todayIst } from '../../lib/dates.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { notify, orgMembers, vtaReviewers } from '../../lib/notify.js';
import { startRazorpayOrder } from '../../lib/payments.js';
import { iso, parse } from '../../lib/validate.js';
import { learnerBlocker } from './catalogue.js';

/**
 * AutoTalent Grid career journeys (29 Oct 2026). A journey course is enrolled in and paid for as a course, not a
 * batch: the learner pays, the booking waits for a batch, and an Admin then places them in a batch of that course
 * at a training partner's centre. A step opens once the learner has completed the step before it.
 */
const idParam = z.object({ id: uuidSchema });
const rupees = (paise: number) => Math.round(paise / 100);
const money = (paise: number) => `₹${rupees(paise).toLocaleString('en-IN')}`;
const coursePaise = (c: Pick<Course, 'fee_paise' | 'gst_pct'>) => c.fee_paise + Math.round((c.fee_paise * c.gst_pct) / 100 / 100) * 100;
const stayPaise = (c: Pick<Course, 'stay_available' | 'stay_fee_paise'>, needsStay: boolean) => (needsStay && c.stay_available ? (c.stay_fee_paise ?? 0) : 0);
/** Learners can book only courses that are published and switched on. */
const bookable = (c: Pick<Course, 'status' | 'approval_status' | 'track'>) => !!c.track && c.status === 'active' && c.approval_status === 'published';

/** Where a course sits in its journey, with the step before it. */
export async function journeyOf(db: DB, c: Pick<Course, 'track' | 'track_step'>): Promise<JourneyInfo | null> {
  if (!c.track || !c.track_step) return null;
  const prev = c.track_step > 1 ? await db.selectFrom('courses').select(['id', 'title']).where('track', '=', c.track).where('track_step', '=', c.track_step - 1).executeTakeFirst() : undefined;
  return { track: c.track as Track, step: c.track_step as TrackStep, previous: prev ? { id: prev.id, title: prev.title } : null };
}

/** Whether the learner has completed a course (a completed enrolment in one of its batches, or its certificate). */
async function completed(db: DB, userId: string, courseId: string): Promise<boolean> {
  const done = await db
    .selectFrom('enrolments as e')
    .innerJoin('batches as b', 'b.id', 'e.batch_id')
    .select('e.id')
    .where('e.candidate_id', '=', userId)
    .where('b.course_id', '=', courseId)
    .where('e.status', '=', 'completed')
    .executeTakeFirst();
  if (done) return true;
  const cert = await db.selectFrom('credentials').select('id').where('candidate_id', '=', userId).where('course_id', '=', courseId).where('status', '=', 'active').executeTakeFirst();
  return !!cert;
}

/** Why this learner cannot enrol in this journey course, or null. */
export async function bookingBlocker(db: DB, userId: string, c: Course): Promise<string | null> {
  const who = await learnerBlocker(db, userId);
  if (who) return who;
  if (!bookable(c)) return 'This course is not open for enrolment.';
  const open = await db.selectFrom('course_bookings').select('id').where('candidate_id', '=', userId).where('course_id', '=', c.id).where('status', '=', 'awaiting_batch').executeTakeFirst();
  if (open) return 'You have already enrolled in this course. AutoTalent Grid will assign your batch.';
  const inBatch = await db
    .selectFrom('enrolments as e')
    .innerJoin('batches as b', 'b.id', 'e.batch_id')
    .select('e.id')
    .where('e.candidate_id', '=', userId)
    .where('b.course_id', '=', c.id)
    .where('e.status', 'in', ['enrolled', 'completed'])
    .executeTakeFirst();
  if (inBatch) return 'You are already enrolled in this course.';
  const j = await journeyOf(db, c);
  if (j?.previous && !(await completed(db, userId, j.previous.id))) return `Complete ${j.previous.title} first. Each step opens after the one before it.`;
  return null;
}

/**
 * Records a paid (or free, or test) booking inside the caller's transaction. Returns the reason when the learner
 * can no longer book (for example the course was switched off while they paid).
 */
export async function createBooking(
  trx: DB,
  ctx: AuditContext,
  userId: string,
  courseId: string,
  pay: { provider: 'test' | 'razorpay'; method: 'upi' | 'card' | 'netbanking' | 'wallet' | 'other'; providerPaymentId?: string; expectedAmount?: number; needsStay: boolean },
): Promise<{ bookingId: string; receiptNumber: string } | { blocked: string }> {
  const c = await trx.selectFrom('courses').selectAll().where('id', '=', courseId).forUpdate().executeTakeFirst();
  if (!c) return { blocked: 'This course is no longer available.' };
  const why = await bookingBlocker(trx, userId, c);
  if (why) return { blocked: why };
  if (pay.needsStay && !c.stay_available) return { blocked: 'This course no longer offers accommodation with food.' };
  const stay = stayPaise(c, pay.needsStay);
  const amount = coursePaise(c) + stay;
  if (pay.expectedAmount !== undefined && pay.expectedAmount !== amount) return { blocked: 'The course fee changed while you were paying.' };

  const seq = (await sql<{ n: string }>`SELECT nextval('enrolment_receipt_seq') AS n`.execute(trx)).rows[0]!.n;
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
  const receipt = `ATG-ENR-${day}-${String(seq).padStart(4, '0')}`;
  const id = newId();
  await trx
    .insertInto('course_bookings')
    .values({
      id,
      candidate_id: userId,
      course_id: c.id,
      needs_stay: pay.needsStay,
      amount_paise: amount,
      stay_paise: stay,
      method: amount > 0 ? pay.method : null,
      provider: amount > 0 ? pay.provider : 'free',
      provider_payment_id: pay.providerPaymentId ?? null,
      receipt_number: receipt,
    })
    .execute();
  await audit(trx, ctx, {
    action: 'course.booked',
    entityType: 'course',
    entityId: c.id,
    after: { candidateId: userId, bookingId: id, amount_paise: amount, needs_stay: pay.needsStay, stay_paise: stay, receipt, provider: amount > 0 ? pay.provider : 'free', ...(pay.providerPaymentId ? { razorpay_payment_id: pay.providerPaymentId } : {}) },
  });
  const learner = await trx.selectFrom('users').select('name').where('id', '=', userId).executeTakeFirstOrThrow();
  await notify(trx, await vtaReviewers(trx), 'course_booked', { learner: learner.name, course: c.title, amount: amount > 0 ? money(amount) : '' }, '/admin/bookings');
  return { bookingId: id, receiptNumber: receipt };
}

/** Open batches of a course with seats: where an Admin can place a booked learner. */
function openBatchesOf(db: DB, courseId: string) {
  return db
    .selectFrom('batches as b')
    .innerJoin('centres as c', 'c.id', 'b.centre_id')
    .leftJoin('organisations as o', 'o.id', 'c.organisation_id')
    .select([
      'b.id',
      'b.name',
      'b.start_date',
      'b.end_date',
      'b.capacity',
      'b.status',
      'c.id as centre_id',
      'c.name as centre',
      'c.city',
      'o.legal_name as org',
      'o.type as org_type',
      sql<string>`(select count(*) from enrolments e where e.batch_id = b.id and e.status <> 'withdrawn')`.as('taken'),
    ])
    .where('b.course_id', '=', courseId)
    .where('b.status', 'in', ['planned', 'active'])
    .where('b.end_date', '>=', todayIst())
    .orderBy('b.start_date');
}

export const bookingRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  // ---------------------------------------------------------------- learner

  /** What the learner will enrol in and pay for a journey course, and whether they can. */
  app.get('/me/book/:id', { config: { permission: 'learner.self' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const c = await db.selectFrom('courses').selectAll().where('id', '=', id).executeTakeFirst();
    if (!c || !c.track) throw notFound('Course');
    return {
      course: {
        id: c.id,
        title: c.title,
        skillArea: c.skill_area,
        deliveryMode: c.delivery_mode,
        durationValue: c.duration_value,
        durationUnit: c.duration_unit,
        feeRupees: rupees(coursePaise(c)),
        stayAvailable: c.stay_available,
        stayFeeRupees: c.stay_available && c.stay_fee_paise !== null ? rupees(c.stay_fee_paise) : null,
        stayMeals: c.stay_meals,
        journey: await journeyOf(db, c),
      },
      blocker: await bookingBlocker(db, req.actor!.userId, c),
      paymentMode: app.config.paymentMode,
    };
  });

  app.post('/me/bookings', { config: { permission: 'learner.self' } }, async (req, reply) => {
    const body = parse(courseBookingSchema, req.body);
    const userId = req.actor!.userId;
    const mode = app.config.paymentMode;
    const c = await db.selectFrom('courses').selectAll().where('id', '=', body.courseId).executeTakeFirst();
    if (!c || !c.track) throw notFound('Course');
    if (body.needsStay && !c.stay_available) throw invalid('This course does not offer accommodation with food', { needsStay: 'Not offered for this course' });
    const amount = coursePaise(c) + stayPaise(c, body.needsStay);
    if (amount > 0 && mode === 'none') throw conflict('Online payment is not set up yet. Contact AutoTalent Grid to enrol.');
    if (amount > 0 && mode === 'test' && !body.method) throw invalid('Choose how to pay', { method: 'Choose how to pay' });

    if (amount > 0 && mode === 'razorpay') {
      const why = await bookingBlocker(db, userId, c);
      if (why) throw conflict(why);
      const learner = await db.selectFrom('users').select(['name', 'email', 'phone']).where('id', '=', userId).executeTakeFirstOrThrow();
      reply.code(201);
      return startRazorpayOrder(app, {
        purpose: 'booking',
        amountPaise: amount,
        payerId: userId,
        courseId: c.id,
        needsStay: body.needsStay,
        description: c.title,
        prefill: { name: learner.name, email: learner.email ?? undefined, contact: learner.phone ?? undefined },
        ctx: auditCtx(req),
      });
    }

    const result = await db.transaction().execute((trx) => createBooking(trx, auditCtx(req), userId, c.id, { provider: 'test', method: body.method ?? 'upi', needsStay: body.needsStay }));
    if ('blocked' in result) throw conflict(result.blocked);
    reply.code(201);
    return result;
  });

  /** The learner's journey courses: waiting for a batch, or placed. */
  app.get('/me/bookings', { config: { permission: 'learner.self' } }, async (req) => {
    const rows = await db
      .selectFrom('course_bookings as k')
      .innerJoin('courses as c', 'c.id', 'k.course_id')
      .leftJoin('enrolments as e', 'e.id', 'k.enrolment_id')
      .leftJoin('batches as b', 'b.id', 'e.batch_id')
      .select(['k.id', 'k.status', 'k.created_at', 'k.needs_stay', 'c.id as course_id', 'c.title', 'c.track', 'c.track_step', 'b.name as batch', 'b.start_date'])
      .where('k.candidate_id', '=', req.actor!.userId)
      .where('k.status', '!=', 'cancelled')
      .orderBy('k.created_at', 'desc')
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        bookedAt: iso(r.created_at),
        needsStay: r.needs_stay,
        course: { id: r.course_id, title: r.title, track: r.track, step: r.track_step },
        batch: r.batch ? { name: r.batch, startDate: r.start_date } : null,
      })),
    };
  });

  /** Confirmation and receipt of a journey course enrolment. */
  app.get('/me/bookings/:id/receipt', { config: { permission: 'learner.self' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await db
      .selectFrom('course_bookings as k')
      .innerJoin('courses as c', 'c.id', 'k.course_id')
      .innerJoin('users as u', 'u.id', 'k.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'k.candidate_id')
      .select(['k.id', 'k.status', 'k.amount_paise', 'k.stay_paise', 'k.needs_stay', 'k.method', 'k.provider', 'k.receipt_number', 'k.created_at', 'c.title', 'c.delivery_mode', 'c.duration_value', 'c.duration_unit', 'c.track', 'c.track_step', 'u.name', 'cp.candidate_code'])
      .where('k.id', '=', id)
      .where('k.candidate_id', '=', req.actor!.userId)
      .executeTakeFirst();
    if (!r) throw notFound('Receipt');
    return {
      bookingId: r.id,
      receiptNumber: r.receipt_number,
      amountRupees: rupees(r.amount_paise),
      stayRupees: rupees(r.stay_paise),
      needsStay: r.needs_stay,
      method: r.method,
      test: r.provider === 'test',
      free: r.provider === 'free',
      paidAt: iso(r.created_at),
      status: r.status,
      learner: { name: r.name, code: r.candidate_code },
      course: { title: r.title, deliveryMode: r.delivery_mode, durationValue: r.duration_value, durationUnit: r.duration_unit, track: r.track, step: r.track_step },
    };
  });

  // ---------------------------------------------------------------- Admin: assign batches

  const bookingFilter = z.object({ status: z.enum(BOOKING_STATUSES).default('awaiting_batch') });

  app.get('/admin/bookings', { config: { permission: 'course.manage' } }, async (req) => {
    const f = parse(bookingFilter, req.query);
    const rows = await db
      .selectFrom('course_bookings as k')
      .innerJoin('courses as c', 'c.id', 'k.course_id')
      .innerJoin('users as u', 'u.id', 'k.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'k.candidate_id')
      .leftJoin('enrolments as e', 'e.id', 'k.enrolment_id')
      .leftJoin('batches as b', 'b.id', 'e.batch_id')
      .select(['k.id', 'k.status', 'k.created_at', 'k.needs_stay', 'k.amount_paise', 'k.provider', 'k.receipt_number', 'k.assigned_at', 'c.id as course_id', 'c.title', 'c.track', 'c.track_step', 'u.id as candidate_id', 'u.name', 'u.phone', 'cp.candidate_code', 'cp.city', 'b.id as batch_id', 'b.name as batch'])
      .where('k.status', '=', f.status)
      .orderBy('k.created_at', f.status === 'awaiting_batch' ? 'asc' : 'desc')
      .limit(500)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        bookedAt: iso(r.created_at),
        assignedAt: iso(r.assigned_at),
        needsStay: r.needs_stay,
        amountRupees: rupees(r.amount_paise),
        test: r.provider === 'test',
        receiptNumber: r.receipt_number,
        course: { id: r.course_id, title: r.title, track: r.track, step: r.track_step },
        learner: { id: r.candidate_id, name: r.name, phone: r.phone, code: r.candidate_code, city: r.city },
        batch: r.batch_id ? { id: r.batch_id, name: r.batch } : null,
      })),
    };
  });

  /** The batches a booking can be placed in. */
  app.get('/admin/bookings/:id/batches', { config: { permission: 'course.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const k = await db.selectFrom('course_bookings').select(['course_id']).where('id', '=', id).executeTakeFirst();
    if (!k) throw notFound('Booking');
    const rows = await openBatchesOf(db, k.course_id).execute();
    return {
      items: rows.map((b) => ({
        id: b.id,
        name: b.name,
        startDate: b.start_date,
        endDate: b.end_date,
        centre: b.centre,
        city: b.city,
        provider: b.org && b.org_type !== 'vta' ? b.org : 'AutoTalent Grid',
        seatsLeft: Math.max(0, b.capacity - Number(b.taken)),
      })),
    };
  });

  /** Places a booked learner in a batch of the course. The learner and whoever runs the centre are told. */
  app.post('/admin/bookings/:id/assign', { config: { permission: 'course.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(assignBookingSchema, req.body);
    const result = await db.transaction().execute(async (trx) => {
      const k = await trx.selectFrom('course_bookings').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!k) throw notFound('Booking');
      if (k.status !== 'awaiting_batch') throw conflict('This learner already has a batch, or the enrolment was cancelled.');
      const batch = await trx.selectFrom('batches').select(['id', 'name', 'course_id', 'capacity', 'status', 'start_date', 'end_date', 'centre_id']).where('id', '=', b.batchId).forUpdate().executeTakeFirst();
      if (!batch || batch.course_id !== k.course_id) throw invalid('Choose a batch of this course', { batchId: 'Not a batch of this course' });
      if (!(batch.status === 'planned' || batch.status === 'active') || batch.end_date < todayIst()) throw invalid('This batch is closed', { batchId: 'Closed' });
      const { n } = await trx.selectFrom('enrolments').select(sql<string>`count(*)`.as('n')).where('batch_id', '=', batch.id).where('status', '!=', 'withdrawn').executeTakeFirstOrThrow();
      if (Number(n) >= batch.capacity) throw conflict('This batch is full. Choose another batch, or raise its capacity.');

      const prior = await trx.selectFrom('enrolments').select(['id', 'status']).where('batch_id', '=', batch.id).where('candidate_id', '=', k.candidate_id).executeTakeFirst();
      if (prior && prior.status !== 'withdrawn') throw conflict('This learner is already in that batch.');
      const enrolmentId = prior?.id ?? newId();
      if (prior) {
        await trx
          .updateTable('enrolments')
          .set({ status: 'enrolled', enrolled_at: new Date(), enrolled_by: req.actor!.userId, withdrawn_at: null, withdraw_reason: null, source: 'self', needs_stay: k.needs_stay, updated_at: new Date() })
          .where('id', '=', prior.id)
          .execute();
      } else {
        await trx.insertInto('enrolments').values({ id: enrolmentId, candidate_id: k.candidate_id, batch_id: batch.id, status: 'enrolled', enrolled_by: req.actor!.userId, source: 'self', needs_stay: k.needs_stay }).execute();
      }
      await trx.updateTable('course_bookings').set({ status: 'placed', enrolment_id: enrolmentId, assigned_by: req.actor!.userId, assigned_at: new Date(), updated_at: new Date() }).where('id', '=', k.id).execute();
      await audit(trx, auditCtx(req), { action: 'course.booking_assigned', entityType: 'batch', entityId: batch.id, after: { bookingId: k.id, candidateId: k.candidate_id, enrolmentId } });

      const course = await trx.selectFrom('courses').select('title').where('id', '=', k.course_id).executeTakeFirstOrThrow();
      const centre = await trx.selectFrom('centres as c').leftJoin('organisations as o', 'o.id', 'c.organisation_id').select(['c.name', 'c.city', 'o.id as org_id', 'o.type']).where('c.id', '=', batch.centre_id).executeTakeFirstOrThrow();
      await notify(trx, [k.candidate_id], 'booking_placed', { course: course.title, batch: batch.name, centre: [centre.name, centre.city].filter(Boolean).join(', '), start: formatDay(batch.start_date) }, '/learn/learning');
      const learner = await trx.selectFrom('users').select('name').where('id', '=', k.candidate_id).executeTakeFirstOrThrow();
      if (centre.org_id && centre.type === 'partner') {
        await notify(trx, await orgMembers(trx, centre.org_id, ['partner_admin']), 'self_enrolled', { learner: learner.name, batch: batch.name, amount: '' }, `/partner/batches/${batch.id}`);
      }
      return { enrolmentId };
    });
    return result;
  });
};
