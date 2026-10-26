import { listQuerySchema, reasonSchema, SKILL_AREAS, trainerCreateSchema, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { newId } from '../../lib/crypto.js';
import { conflict, invalid, notFound } from '../../lib/errors.js';
import { iso, parse } from '../../lib/validate.js';
import { inScope, trainerReadScope } from '../../policy/index.js';
import { grantRole } from '../admin/roles.js';

const idParam = z.object({ id: uuidSchema });

const filterSchema = listQuerySchema.extend({
  centreId: uuidSchema.optional(),
  verificationStatus: z.enum(['pending', 'verified', 'rejected', 'more_info_needed']).optional(),
});

/** T-02: trainers, their centres and verification. */
export const trainerRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  const centresFor = async (userIds: string[]) =>
    userIds.length
      ? db
          .selectFrom('role_assignments as ra')
          .innerJoin('centres as c', 'c.id', 'ra.centre_id')
          .leftJoin('organisations as o', 'o.id', 'c.organisation_id')
          .select(['ra.id as assignment_id', 'ra.user_id', 'c.id', 'c.name', 'c.city', 'o.legal_name as organisation_name'])
          .where('ra.role', '=', 'trainer')
          .where('ra.revoked_at', 'is', null)
          .where('ra.user_id', 'in', userIds)
          .orderBy('c.name')
          .execute()
      : [];

  app.get('/trainers', { config: { permission: 'trainer.read' } }, async (req) => {
    const f = parse(filterSchema, req.query);
    const scope = await trainerReadScope(db, req.actor!);
    if (scope !== 'all' && scope.length === 0) return { items: [], page: f.page, pageSize: f.pageSize, total: 0 };
    let q = db
      .selectFrom('trainer_profiles as tp')
      .innerJoin('users as u', 'u.id', 'tp.user_id')
      .where((eb) =>
        eb.exists(eb.selectFrom('role_assignments as ra').select('ra.id').whereRef('ra.user_id', '=', 'u.id').where('ra.role', '=', 'trainer').where('ra.revoked_at', 'is', null)),
      );
    if (scope !== 'all') q = q.where('u.id', 'in', scope);
    if (f.verificationStatus) q = q.where('tp.verification_status', '=', f.verificationStatus);
    if (f.centreId) {
      const centreId = f.centreId;
      q = q.where((eb) =>
        eb.exists(
          eb.selectFrom('role_assignments as r2').select('r2.id').whereRef('r2.user_id', '=', 'u.id').where('r2.role', '=', 'trainer').where('r2.centre_id', '=', centreId).where('r2.revoked_at', 'is', null),
        ),
      );
    }
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('u.name', 'ilike', like), eb('u.phone', 'ilike', like)]));
    }
    const { total } = await q.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
    const rows = await q
      .select([
        'u.id',
        'u.name',
        'u.phone',
        'u.email',
        'u.status as user_status',
        'tp.specialisations',
        'tp.verification_status',
        'tp.verification_reason',
        sql<string>`(select count(*) from batches b where b.trainer_id = u.id and b.status in ('planned','active'))`.as('open_batches'),
      ])
      .orderBy('u.name')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    const centres = await centresFor(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        userStatus: r.user_status,
        specialisations: r.specialisations,
        verificationStatus: r.verification_status,
        verificationReason: r.verification_reason,
        openBatches: Number(r.open_batches),
        centres: centres.filter((c) => c.user_id === r.id).map((c) => ({ assignmentId: c.assignment_id, id: c.id, name: c.name, city: c.city, organisationName: c.organisation_name })),
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });

  app.get('/trainers/:id', { config: { permission: 'trainer.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    if (!inScope(await trainerReadScope(db, req.actor!), id)) throw notFound('Trainer');
    const t = await db
      .selectFrom('trainer_profiles as tp')
      .innerJoin('users as u', 'u.id', 'tp.user_id')
      .select(['u.id', 'u.name', 'u.phone', 'u.email', 'u.status as user_status', 'tp.specialisations', 'tp.verification_status', 'tp.verification_reason', 'tp.verified_at'])
      .where('u.id', '=', id)
      .executeTakeFirst();
    if (!t) throw notFound('Trainer');
    const centres = await centresFor([id]);
    const batches = await db
      .selectFrom('batches as b')
      .innerJoin('courses as c', 'c.id', 'b.course_id')
      .select(['b.id', 'b.name', 'b.status', 'b.start_date', 'b.end_date', 'c.title as course_title'])
      .where('b.trainer_id', '=', id)
      .orderBy('b.start_date', 'desc')
      .limit(20)
      .execute();
    return {
      id: t.id,
      name: t.name,
      phone: t.phone,
      email: t.email,
      userStatus: t.user_status,
      specialisations: t.specialisations,
      verificationStatus: t.verification_status,
      verificationReason: t.verification_reason,
      verifiedAt: iso(t.verified_at),
      centres: centres.map((c) => ({ assignmentId: c.assignment_id, id: c.id, name: c.name, city: c.city, organisationName: c.organisation_name })),
      batches: batches.map((b) => ({ id: b.id, name: b.name, status: b.status, startDate: b.start_date, endDate: b.end_date, courseTitle: b.course_title })),
    };
  });

  /** Adds a new trainer: an invited phone user + trainer profile + first centre. Activates on first OTP sign-in. */
  app.post('/admin/trainers', { config: { permission: 'trainer.manage' } }, async (req, reply) => {
    const b = parse(trainerCreateSchema, req.body);
    const fields: Record<string, string> = {};
    if (await db.selectFrom('users').select('id').where('phone', '=', b.phone).executeTakeFirst()) fields.phone = 'Already registered';
    if (b.email && (await db.selectFrom('users').select('id').where('email', '=', b.email).executeTakeFirst())) fields.email = 'Already in use';
    if (Object.keys(fields).length) throw conflict('A user with these details already exists. Add the trainer role to that user instead.', fields);
    const id = newId();
    await db.transaction().execute(async (trx) => {
      const user = { id, name: b.name, phone: b.phone, email: b.email ?? null, status: 'invited' as const };
      await trx.insertInto('users').values(user).execute();
      await trx.insertInto('trainer_profiles').values({ user_id: id, specialisations: b.specialisations, verification_status: 'pending' }).execute();
      await audit(trx, auditCtx(req), { action: 'trainer.created', entityType: 'user', entityId: id, after: { ...user, specialisations: b.specialisations } });
      await grantRole(trx, req, { userId: id, role: 'trainer', centreId: b.centreId });
    });
    reply.code(201);
    return { id };
  });

  app.patch('/admin/trainers/:id', { config: { permission: 'trainer.manage' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(z.object({ specialisations: z.array(z.enum(SKILL_AREAS)).max(5) }), req.body);
    const tp = await db.selectFrom('trainer_profiles').selectAll().where('user_id', '=', id).executeTakeFirst();
    if (!tp) throw notFound('Trainer');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('trainer_profiles').set({ specialisations: b.specialisations, updated_at: new Date() }).where('user_id', '=', id).execute();
      await audit(trx, auditCtx(req), { action: 'trainer.updated', entityType: 'user', entityId: id, before: { specialisations: tp.specialisations }, after: { specialisations: b.specialisations } });
    });
    return { id };
  });

  /** Assigns the trainer to another centre (a second trainer role scoped to that centre). */
  app.post('/admin/trainers/:id/centres', { config: { permission: 'trainer.manage' } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { centreId } = parse(z.object({ centreId: uuidSchema }), req.body);
    const tp = await db.selectFrom('trainer_profiles').select('user_id').where('user_id', '=', id).executeTakeFirst();
    if (!tp) throw notFound('Trainer');
    const assignmentId = await db.transaction().execute((trx) => grantRole(trx, req, { userId: id, role: 'trainer', centreId }));
    reply.code(201);
    return { assignmentId };
  });

  const decisions = [
    { path: 'verify', to: 'verified', needsReason: false },
    { path: 'reject', to: 'rejected', needsReason: true },
    { path: 'request-info', to: 'more_info_needed', needsReason: true },
  ] as const;
  for (const d of decisions) {
    app.post(`/admin/trainers/:id/${d.path}`, { config: { permission: 'trainer.manage' } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const reason = d.needsReason ? parse(reasonSchema, req.body).reason : null;
      const tp = await db.selectFrom('trainer_profiles').selectAll().where('user_id', '=', id).executeTakeFirst();
      if (!tp) throw notFound('Trainer');
      if (tp.verification_status === d.to) throw invalid(`This trainer is already ${d.to.replace(/_/g, ' ')}.`);
      const now = new Date();
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('trainer_profiles')
          .set({
            verification_status: d.to,
            verification_reason: reason,
            verified_by: d.to === 'verified' ? req.actor!.userId : null,
            verified_at: d.to === 'verified' ? now : null,
            updated_at: now,
          })
          .where('user_id', '=', id)
          .execute();
        await audit(trx, auditCtx(req), { action: `trainer.${d.to}`, entityType: 'user', entityId: id, before: { verification_status: tp.verification_status }, after: { verification_status: d.to, reason } });
      });
      return { id, verificationStatus: d.to };
    });
  }
};
