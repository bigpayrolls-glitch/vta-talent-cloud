import { ROLE_SCOPE, ROLES, uuidSchema } from '@vta/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import type { Database } from '../../db/types.js';
import { newId } from '../../lib/crypto.js';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';

type Executor = Kysely<Database> | Transaction<Database>;

export const roleInputSchema = z.object({
  role: z.enum(ROLES),
  organisationId: uuidSchema.optional(),
  centreId: uuidSchema.optional(),
});
const grantSchema = roleInputSchema.extend({ userId: uuidSchema });

/**
 * F-09: grant a role with the scope that role requires (plan §6.1, §10.2):
 * - employer roles need a verified-or-pending employer organisation
 * - partner roles need a partner organisation
 * - trainer needs a centre; the organisation is the centre's owner (none for a VTA-run centre)
 * - centre admin needs a centre; platform roles take no scope
 */
export async function grantRole(db: Executor, req: FastifyRequest, input: z.infer<typeof grantSchema>): Promise<string> {
  const rule = ROLE_SCOPE[input.role];
  const fields: Record<string, string> = {};

  // Trainers: the organisation is whoever runs the centre (a partner, or none for VTA-run centres).
  if (rule.organisationFromCentre && input.centreId) {
    const centre = await db.selectFrom('centres').select(['organisation_id']).where('id', '=', input.centreId).executeTakeFirst();
    if (!centre) throw invalid('Centre not found', { centreId: 'Not found' });
    if (input.organisationId && input.organisationId !== centre.organisation_id) {
      throw invalid('A trainer’s centre must belong to their training partner', { centreId: 'Centre is not run by this partner' });
    }
    input = { ...input, organisationId: centre.organisation_id ?? undefined };
    if (!input.organisationId) return insertGrant(db, req, input);
  }

  // Independent (freelance) trainers: no centre and no organisation until they are given a batch.
  if (rule.centreOptional && !input.centreId && !input.organisationId) return insertGrant(db, req, input);

  // One login per employer and per training partner (decision of 27 Oct 2026).
  if ((input.role === 'employer_admin' || input.role === 'partner_admin') && input.organisationId) {
    const taken = await db
      .selectFrom('role_assignments')
      .select('id')
      .where('organisation_id', '=', input.organisationId)
      .where('role', '=', input.role)
      .where('revoked_at', 'is', null)
      .where('user_id', '!=', input.userId)
      .executeTakeFirst();
    if (taken) throw invalid('This organisation already has its login. Each employer and training partner has one login.', { organisationId: 'Already has a login' });
  }

  if (rule.organisation && !input.organisationId) fields.organisationId = 'Choose an organisation for this role';
  if (!rule.organisation && input.organisationId) fields.organisationId = 'This role is not tied to an organisation';
  if (rule.centre && !input.centreId) fields.centreId = 'Choose a centre for this role';
  if (!rule.centre && input.centreId) fields.centreId = 'This role is not tied to a centre';
  if (Object.keys(fields).length) throw invalid('The role scope is not valid', fields);

  if (input.organisationId) {
    const org = await db.selectFrom('organisations').select(['type', 'status']).where('id', '=', input.organisationId).executeTakeFirst();
    if (!org) throw invalid('Organisation not found', { organisationId: 'Not found' });
    if (org.type !== rule.organisation) throw invalid(`This role needs a ${rule.organisation} organisation`, { organisationId: 'Wrong organisation type' });
    if (org.status !== 'active') throw invalid('This organisation is inactive', { organisationId: 'Inactive' });
  }
  if (input.centreId) {
    const centre = await db.selectFrom('centres').select(['id']).where('id', '=', input.centreId).executeTakeFirst();
    if (!centre) throw invalid('Centre not found', { centreId: 'Not found' });
  }

  return insertGrant(db, req, input);
}

async function insertGrant(db: Executor, req: FastifyRequest, input: z.infer<typeof grantSchema>): Promise<string> {
  const user = await db.selectFrom('users').select(['status']).where('id', '=', input.userId).executeTakeFirst();
  if (!user) throw notFound('User');
  if (user.status === 'deactivated') throw invalid('Roles cannot be given to a deactivated user.');
  if (input.centreId) {
    const c = await db.selectFrom('centres').select(['status']).where('id', '=', input.centreId).executeTakeFirst();
    if (c?.status !== 'active') throw invalid('This centre is inactive', { centreId: 'Inactive' });
  }
  const id = newId();
  try {
    await db
      .insertInto('role_assignments')
      .values({
        id,
        user_id: input.userId,
        role: input.role,
        organisation_id: input.organisationId ?? null,
        centre_id: input.centreId ?? null,
        granted_by: req.actor?.userId ?? null,
      })
      .execute();
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('The user already has this role with this scope.');
    throw e;
  }
  // Every trainer has a profile (specialisations, verification), however the role was given.
  if (input.role === 'trainer') {
    await db
      .insertInto('trainer_profiles')
      .values({ user_id: input.userId, verification_status: 'pending' })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute();
  }
  await audit(db, auditCtx(req), {
    action: 'role.granted',
    entityType: 'user',
    entityId: input.userId,
    after: { assignmentId: id, role: input.role, organisationId: input.organisationId ?? null, centreId: input.centreId ?? null },
  });
  return id;
}

export const roleRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;

  app.post('/role-assignments', { config: { permission: 'role.assign' } }, async (req, reply) => {
    const input = parse(grantSchema, req.body);
    const id = await db.transaction().execute((trx) => grantRole(trx, req, input));
    reply.code(201);
    return { id };
  });

  app.post('/role-assignments/:id/revoke', { config: { permission: 'role.assign' } }, async (req) => {
    const { id } = parse(z.object({ id: uuidSchema }), req.params);
    const ra = await db.selectFrom('role_assignments').selectAll().where('id', '=', id).where('revoked_at', 'is', null).executeTakeFirst();
    if (!ra) throw notFound('Role assignment');
    if (ra.role === 'super_admin') {
      const others = await db
        .selectFrom('role_assignments as r')
        .innerJoin('users as u', 'u.id', 'r.user_id')
        .select('r.id')
        .where('r.role', '=', 'super_admin')
        .where('r.revoked_at', 'is', null)
        .where('u.status', '=', 'active')
        .where('r.id', '!=', id)
        .execute();
      if (others.length === 0) throw forbidden('This is the last active Admin. Make someone else an Admin first.');
    }
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('role_assignments').set({ revoked_at: new Date(), revoked_by: req.actor!.userId }).where('id', '=', id).execute();
      await audit(trx, auditCtx(req), {
        action: 'role.revoked',
        entityType: 'user',
        entityId: ra.user_id,
        before: { assignmentId: id, role: ra.role, organisationId: ra.organisation_id, centreId: ra.centre_id },
      });
    });
    return { ok: true };
  });
};
