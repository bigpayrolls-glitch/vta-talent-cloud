import { BATCH_STATUSES, batchSchema, batchUpdateSchema, enrolSchema, listQuerySchema, reasonSchema, uuidSchema, type Page } from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { DB } from '../../db/index.js';
import type { Batch, Database } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { invalid, notFound } from '../../lib/errors.js';
import { iso, parse } from '../../lib/validate.js';
import { batchManageScope, batchReadScope, batchVisible, inScope, rosterShowsContact, type BatchScope } from '../../policy/index.js';

type Executor = Kysely<Database> | Transaction<Database>;
const idParam = z.object({ id: uuidSchema });

const filterSchema = listQuerySchema.extend({
  status: z.enum(BATCH_STATUSES).optional(),
  courseId: uuidSchema.optional(),
  centreId: uuidSchema.optional(),
  trainerId: uuidSchema.optional(),
});

/** Applies the actor's batch read scope to a query on `batches as b`. */
function scoped<Q extends { where: (...args: any[]) => Q }>(q: Q, scope: BatchScope): Q {
  if (scope === 'all') return q;
  return q.where((eb: any) =>
    eb.or([
      ...(scope.centreIds.length ? [eb('b.centre_id', 'in', scope.centreIds)] : []),
      ...(scope.trainer ? [eb.and([eb('b.trainer_id', '=', scope.trainer.userId), eb('b.centre_id', 'in', scope.trainer.centreIds)])] : []),
      eb.val(false),
    ]),
  );
}

const enrolledCount = sql<string>`(select count(*) from enrolments e where e.batch_id = b.id and e.status <> 'withdrawn')`;

async function loadVisibleBatch(db: DB, req: FastifyRequest, id: string): Promise<Batch> {
  const batch = await db.selectFrom('batches').selectAll().where('id', '=', id).executeTakeFirst();
  if (!batch || !batchVisible(await batchReadScope(db, req.actor!), batch)) throw notFound('Batch');
  return batch;
}

/** For changes: the batch must be at a centre the actor manages. Others get "not found". */
async function loadManagedBatch(db: Executor, req: FastifyRequest, id: string, forUpdate = false): Promise<Batch> {
  let q = db.selectFrom('batches').selectAll().where('id', '=', id);
  if (forUpdate) q = q.forUpdate();
  const batch = await q.executeTakeFirst();
  if (!batch || !inScope(batchManageScope(req.actor!), batch.centre_id)) throw notFound('Batch');
  return batch;
}

/** A batch's trainer must be active, verified and hold the trainer role at that centre. */
async function assertTrainerFits(db: Executor, trainerId: string, centreId: string) {
  const t = await db
    .selectFrom('users as u')
    .leftJoin('trainer_profiles as tp', 'tp.user_id', 'u.id')
    .select(['u.status', 'tp.verification_status'])
    .where('u.id', '=', trainerId)
    .executeTakeFirst();
  const atCentre = await db
    .selectFrom('role_assignments')
    .select('id')
    .where('user_id', '=', trainerId)
    .where('role', '=', 'trainer')
    .where('centre_id', '=', centreId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (!t || !atCentre) throw invalid('Choose a trainer assigned to this centre', { trainerId: 'Not a trainer at this centre' });
  if (t.verification_status !== 'verified') throw invalid('This trainer is not verified yet', { trainerId: 'Trainer not verified' });
  if (t.status === 'suspended' || t.status === 'deactivated') throw invalid('This trainer’s account is not active', { trainerId: 'Account not active' });
}

export const batchRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const listQuery = () =>
    db
      .selectFrom('batches as b')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .innerJoin('centres as ce', 'ce.id', 'b.centre_id')
      .innerJoin('users as t', 't.id', 'b.trainer_id');

  const dto = (r: {
    id: string; name: string; status: string; start_date: string; end_date: string; capacity: number; enrolled: string;
    course_id: string; course_title: string; skill_area: string; centre_id: string; centre_name: string; centre_city: string | null;
    trainer_id: string; trainer_name: string;
  }) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    capacity: r.capacity,
    enrolled: Number(r.enrolled),
    course: { id: r.course_id, title: r.course_title, skillArea: r.skill_area },
    centre: { id: r.centre_id, name: r.centre_name, city: r.centre_city },
    trainer: { id: r.trainer_id, name: r.trainer_name },
  });

  const columns = [
    'b.id', 'b.name', 'b.status', 'b.start_date', 'b.end_date', 'b.capacity', 'b.course_id', 'c.title as course_title', 'c.skill_area',
    'b.centre_id', 'ce.name as centre_name', 'ce.city as centre_city', 'b.trainer_id', 't.name as trainer_name',
  ] as const;

  /** Scoped batch list: same URL, different rows per user (TR-01, T-05). */
  app.get('/batches', { config: { permission: 'batch.read' } }, async (req): Promise<Page<ReturnType<typeof dto>>> => {
    const f = parse(filterSchema, req.query);
    let q = scoped(listQuery(), await batchReadScope(db, req.actor!));
    if (f.status) q = q.where('b.status', '=', f.status);
    if (f.courseId) q = q.where('b.course_id', '=', f.courseId);
    if (f.centreId) q = q.where('b.centre_id', '=', f.centreId);
    if (f.trainerId) q = q.where('b.trainer_id', '=', f.trainerId);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('b.name', 'ilike', like), eb('c.title', 'ilike', like)]));
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select([...columns, enrolledCount.as('enrolled')])
      .orderBy(sql`case b.status when 'active' then 0 when 'planned' then 1 when 'completed' then 2 else 3 end`)
      .orderBy('b.start_date', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    return { items: rows.map(dto), page: f.page, pageSize: f.pageSize, total: Number(total) };
  });

  app.get('/batches/:id', { config: { permission: 'batch.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const batch = await loadVisibleBatch(db, req, id);
    const row = await listQuery().select([...columns, enrolledCount.as('enrolled'), 'b.cancel_reason']).where('b.id', '=', id).executeTakeFirstOrThrow();
    return {
      ...dto(row),
      cancelReason: row.cancel_reason,
      canManage: inScope(batchManageScope(req.actor!), batch.centre_id),
    };
  });

  /** TR-02 roster: enrolment status for each candidate, searchable by name or code. Phone only for those allowed to see it. */
  app.get('/batches/:id/roster', { config: { permission: 'batch.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { q } = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
    const batch = await loadVisibleBatch(db, req, id);
    const showContact = rosterShowsContact(req.actor!, batch);
    let rq = db
      .selectFrom('enrolments as e')
      .innerJoin('users as u', 'u.id', 'e.candidate_id')
      .innerJoin('candidate_profiles as cp', 'cp.user_id', 'u.id')
      .select(['e.id', 'e.status', 'e.enrolled_at', 'e.withdraw_reason', 'u.id as candidate_id', 'u.name', 'u.phone', 'cp.candidate_code', 'cp.verification_status'])
      .where('e.batch_id', '=', id);
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      rq = rq.where((eb) => eb.or([eb('u.name', 'ilike', like), eb('cp.candidate_code', 'ilike', like)]));
    }
    const rows = await rq.orderBy(sql`e.status = 'withdrawn'`).orderBy('u.name').execute();
    return {
      showContact,
      items: rows.map((r) => ({
        enrolmentId: r.id,
        status: r.status,
        enrolledAt: iso(r.enrolled_at),
        withdrawReason: r.withdraw_reason,
        candidateId: r.candidate_id,
        code: r.candidate_code,
        name: r.name,
        verificationStatus: r.verification_status,
        ...(showContact && { phone: r.phone }),
      })),
    };
  });

  /** T-04: create a batch. Centre admins only at their own centres. */
  app.post('/admin/batches', { config: { permission: 'batch.manage' } }, async (req, reply) => {
    const b = parse(batchSchema, req.body);
    if (!inScope(batchManageScope(req.actor!), b.centreId)) throw invalid('Centre not found', { centreId: 'Not found' });
    const course = await db.selectFrom('courses').select(['status']).where('id', '=', b.courseId).executeTakeFirst();
    if (!course) throw invalid('Course not found', { courseId: 'Not found' });
    if (course.status !== 'active') throw invalid('This course is inactive', { courseId: 'Course is inactive' });
    const centre = await db.selectFrom('centres').select(['status']).where('id', '=', b.centreId).executeTakeFirst();
    if (!centre) throw invalid('Centre not found', { centreId: 'Not found' });
    if (centre.status !== 'active') throw invalid('This centre is inactive', { centreId: 'Centre is inactive' });
    await assertTrainerFits(db, b.trainerId, b.centreId);
    const row = {
      id: newId(),
      name: b.name,
      course_id: b.courseId,
      centre_id: b.centreId,
      trainer_id: b.trainerId,
      start_date: b.startDate,
      end_date: b.endDate,
      capacity: b.capacity,
      status: 'planned' as const,
      created_by: req.actor!.userId,
    };
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('batches').values(row).execute();
      await audit(trx, auditCtx(req), { action: 'batch.created', entityType: 'batch', entityId: row.id, after: row });
    });
    reply.code(201);
    return { id: row.id };
  });

  app.patch('/admin/batches/:id', { config: { permission: 'batch.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(batchUpdateSchema, req.body);
    return db.transaction().execute(async (trx) => {
      const cur = await loadManagedBatch(trx, req, id, true);
      if (cur.status === 'completed' || cur.status === 'cancelled') throw invalid(`A ${cur.status} batch cannot be changed.`);
      const startDate = b.startDate ?? cur.start_date;
      const endDate = b.endDate ?? cur.end_date;
      if (endDate < startDate) throw invalid('End date must be on or after the start date', { endDate: 'Before the start date' });
      if (b.trainerId && b.trainerId !== cur.trainer_id) await assertTrainerFits(trx, b.trainerId, cur.centre_id);
      if (b.capacity !== undefined) {
        const { n } = await trx.selectFrom('enrolments').select(sql<string>`count(*)`.as('n')).where('batch_id', '=', id).where('status', '!=', 'withdrawn').executeTakeFirstOrThrow();
        if (b.capacity < Number(n)) throw invalid(`${n} candidates are enrolled, so capacity cannot be lower than that`, { capacity: `At least ${n}` });
      }
      const changes = {
        ...(b.name !== undefined && b.name !== cur.name && { name: b.name }),
        ...(b.trainerId !== undefined && b.trainerId !== cur.trainer_id && { trainer_id: b.trainerId }),
        ...(startDate !== cur.start_date && { start_date: startDate }),
        ...(endDate !== cur.end_date && { end_date: endDate }),
        ...(b.capacity !== undefined && b.capacity !== cur.capacity && { capacity: b.capacity }),
      };
      if (!Object.keys(changes).length) return { id };
      await trx.updateTable('batches').set({ ...changes, updated_at: new Date() }).where('id', '=', id).execute();
      const before = Object.fromEntries(Object.keys(changes).map((k) => [k, cur[k as keyof Batch]]));
      await audit(trx, auditCtx(req), { action: 'batch.updated', entityType: 'batch', entityId: id, before, after: changes });
      return { id };
    });
  });

  /** Batch status: planned → active → completed; planned or active → cancelled (with a reason). */
  const transitions = [
    { path: 'start', from: ['planned'], to: 'active', needsReason: false },
    { path: 'complete', from: ['active'], to: 'completed', needsReason: false },
    { path: 'cancel', from: ['planned', 'active'], to: 'cancelled', needsReason: true },
  ] as const;
  for (const t of transitions) {
    app.post(`/admin/batches/:id/${t.path}`, { config: { permission: 'batch.manage' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const reason = t.needsReason ? parse(reasonSchema, req.body).reason : null;
      return db.transaction().execute(async (trx) => {
        const cur = await loadManagedBatch(trx, req, id, true);
        if (!(t.from as readonly string[]).includes(cur.status)) throw invalid(`A ${cur.status} batch cannot be moved to ${t.to}.`);
        await trx
          .updateTable('batches')
          .set({ status: t.to, ...(reason && { cancel_reason: reason }), updated_at: new Date() })
          .where('id', '=', id)
          .execute();
        await audit(trx, auditCtx(req), { action: `batch.${t.to}`, entityType: 'batch', entityId: id, before: { status: cur.status }, after: { status: t.to, reason } });
        return { id, status: t.to };
      });
    });
  }

  /** Candidates that can be added: not rejected, no unreviewed duplicate flag, account usable, not already enrolled. Minimal fields only. */
  app.get('/admin/batches/:id/candidate-options', { config: { permission: 'batch.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { q } = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
    await loadManagedBatch(db, req, id);
    let cq = db
      .selectFrom('candidate_profiles as cp')
      .innerJoin('users as u', 'u.id', 'cp.user_id')
      .select(['u.id', 'u.name', 'cp.candidate_code', 'cp.city', 'cp.verification_status'])
      .where('cp.verification_status', 'in', ['pending', 'verified'])
      .where('cp.duplicate_of', 'is', null)
      .where('u.status', 'in', ['invited', 'active'])
      .where((eb) =>
        eb.not(eb.exists(eb.selectFrom('enrolments as e').select('e.id').whereRef('e.candidate_id', '=', 'u.id').where('e.batch_id', '=', id).where('e.status', '!=', 'withdrawn'))),
      );
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      cq = cq.where((eb) => eb.or([eb('u.name', 'ilike', like), eb('cp.candidate_code', 'ilike', like)]));
    }
    const rows = await cq.orderBy('u.name').limit(20).execute();
    return { items: rows.map((r) => ({ id: r.id, name: r.name, code: r.candidate_code, city: r.city, verificationStatus: r.verification_status })) };
  });

  /**
   * T-04: enrol candidates. All or nothing: if any candidate cannot be enrolled, nobody is,
   * and the response says why for each. Capacity is checked with the batch row locked.
   */
  app.post('/admin/batches/:id/enrolments', { config: { permission: 'batch.manage' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { candidateIds } = parse(enrolSchema, req.body);
    const unique = [...new Set(candidateIds)];
    const result = await db.transaction().execute(async (trx) => {
      const batch = await loadManagedBatch(trx, req, id, true);
      if (batch.status !== 'planned' && batch.status !== 'active') throw invalid(`Candidates cannot be enrolled in a ${batch.status} batch.`);
      const candidates = await trx
        .selectFrom('candidate_profiles as cp')
        .innerJoin('users as u', 'u.id', 'cp.user_id')
        .select(['u.id', 'u.name', 'u.status', 'cp.verification_status', 'cp.duplicate_of'])
        .where('u.id', 'in', unique)
        .execute();
      const existing = await trx.selectFrom('enrolments').select(['id', 'candidate_id', 'status']).where('batch_id', '=', id).where('candidate_id', 'in', unique).execute();
      const problems: Record<string, string> = {};
      for (const cid of unique) {
        const c = candidates.find((x) => x.id === cid);
        const e = existing.find((x) => x.candidate_id === cid);
        if (!c) problems[cid] = 'Candidate not found';
        else if (c.status === 'suspended' || c.status === 'deactivated') problems[cid] = `${c.name}: account is ${c.status}`;
        else if (c.verification_status === 'rejected' || c.verification_status === 'needs_correction') problems[cid] = `${c.name}: profile is ${c.verification_status.replace('_', ' ')}`;
        else if (c.duplicate_of) problems[cid] = `${c.name}: possible duplicate, review the profile first`;
        else if (e && e.status !== 'withdrawn') problems[cid] = `${c.name}: already enrolled`;
      }
      if (Object.keys(problems).length) throw invalid('Some candidates cannot be enrolled. Nobody was added.', problems);
      const { n } = await trx.selectFrom('enrolments').select(sql<string>`count(*)`.as('n')).where('batch_id', '=', id).where('status', '!=', 'withdrawn').executeTakeFirstOrThrow();
      const free = batch.capacity - Number(n);
      if (unique.length > free) throw invalid(free <= 0 ? 'This batch is full.' : `Only ${free} ${free === 1 ? 'place is' : 'places are'} left in this batch.`, { capacity: `${n} of ${batch.capacity} enrolled` });

      for (const cid of unique) {
        const e = existing.find((x) => x.candidate_id === cid);
        if (e) {
          await trx
            .updateTable('enrolments')
            .set({ status: 'enrolled', enrolled_at: new Date(), enrolled_by: req.actor!.userId, withdrawn_at: null, withdraw_reason: null, updated_at: new Date() })
            .where('id', '=', e.id)
            .execute();
        } else {
          await trx.insertInto('enrolments').values({ id: newId(), candidate_id: cid, batch_id: id, status: 'enrolled', enrolled_by: req.actor!.userId }).execute();
        }
      }
      await audit(trx, auditCtx(req), { action: 'batch.enrolled', entityType: 'batch', entityId: id, after: { candidateIds: unique } });
      return { enrolled: unique.length, enrolledTotal: Number(n) + unique.length, capacity: batch.capacity };
    });
    reply.code(201);
    return result;
  });

  app.post('/admin/enrolments/:id/withdraw', { config: { permission: 'batch.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonSchema, req.body);
    return db.transaction().execute(async (trx) => {
      const e = await trx.selectFrom('enrolments').selectAll().where('id', '=', id).executeTakeFirst();
      if (!e) throw notFound('Enrolment');
      const batch = await loadManagedBatch(trx, req, e.batch_id, true);
      if (batch.status === 'completed' || batch.status === 'cancelled') throw invalid(`Enrolments in a ${batch.status} batch cannot change.`);
      if (e.status !== 'enrolled') throw invalid('Only an enrolled candidate can be withdrawn.');
      await trx.updateTable('enrolments').set({ status: 'withdrawn', withdrawn_at: new Date(), withdraw_reason: reason, updated_at: new Date() }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), {
        action: 'enrolment.withdrawn',
        entityType: 'batch',
        entityId: e.batch_id,
        before: { candidateId: e.candidate_id, status: e.status },
        after: { candidateId: e.candidate_id, status: 'withdrawn', reason },
      });
      return { id, status: 'withdrawn' };
    });
  });
};
