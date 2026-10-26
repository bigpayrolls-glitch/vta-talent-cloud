import { changePhoneSchema, emailSchema, listQuerySchema, nameSchema, phoneSchema, reasonSchema, ROLES, uuidSchema, type Page } from '@vta/shared';
import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditCtx } from '../../app.js';
import { audit } from '../../audit/service.js';
import { revokeUserSessions } from '../../auth/sessions.js';
import type { DB } from '../../db/index.js';
import type { User } from '../../db/types.js';
import { newId, randomToken, sha256 } from '../../lib/crypto.js';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { iso, parse } from '../../lib/validate.js';
import { assertPermission, isSuperAdmin, type Actor } from '../../policy/index.js';
import { grantRole, roleInputSchema } from './roles.js';

const INVITE_TTL_DAYS = 7;

const userFilterSchema = listQuerySchema.extend({
  status: z.enum(['invited', 'pending', 'active', 'suspended', 'deactivated']).optional(),
  role: z.enum(ROLES).optional(),
});

const inviteSchema = z
  .object({
    name: nameSchema,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    role: roleInputSchema.optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Give an email or a phone number', path: ['email'] });

const idParam = z.object({ id: uuidSchema });

export function userDto(u: User, roles: { role: string }[] = []) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    status: u.status,
    roles: [...new Set(roles.map((r) => r.role))],
    lastLoginAt: iso(u.last_login_at),
    createdAt: iso(u.created_at),
  };
}

async function loadUser(db: DB, id: string): Promise<User> {
  const user = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  if (!user) throw notFound('User');
  return user;
}

/** Only a Super Admin may act on another Super Admin's account. Nobody may act on their own status. */
async function assertCanManage(db: DB, actor: Actor, target: User): Promise<void> {
  if (target.id === actor.userId) throw forbidden('You cannot change the status of your own account.');
  const targetIsSuper = await db
    .selectFrom('role_assignments')
    .select('id')
    .where('user_id', '=', target.id)
    .where('role', '=', 'super_admin')
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (targetIsSuper && !isSuperAdmin(actor)) throw forbidden('Only a Super Admin can change a Super Admin account.');
}

export async function createInvitation(db: DB, userId: string, invitedBy: string): Promise<string> {
  const token = randomToken();
  await db
    .updateTable('invitations')
    .set({ expires_at: new Date() })
    .where('user_id', '=', userId)
    .where('accepted_at', 'is', null)
    .execute();
  await db
    .insertInto('invitations')
    .values({
      id: newId(),
      user_id: userId,
      token_hash: sha256(token),
      invited_by: invitedBy,
      expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    })
    .execute();
  return token;
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  const db = app.db;
  const inviteLink = (token: string) => `${app.config.APP_ORIGIN}/invite/${token}`;

  app.get('/users', { config: { permission: 'user.read' } }, async (req): Promise<Page<ReturnType<typeof userDto>>> => {
    const f = parse(userFilterSchema, req.query);
    let q = db.selectFrom('users as u');
    if (f.status) q = q.where('u.status', '=', f.status);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([eb('u.name', 'ilike', like), eb('u.email', 'ilike', like), eb('u.phone', 'ilike', like)]));
    }
    if (f.role) {
      const role = f.role;
      q = q.where((eb) =>
        eb.exists(
          eb.selectFrom('role_assignments as ra').select('ra.id').whereRef('ra.user_id', '=', 'u.id').where('ra.role', '=', role).where('ra.revoked_at', 'is', null),
        ),
      );
    }
    const [{ total }] = (await q.select((eb) => eb.fn.countAll<string>().as('total')).execute()) as [{ total: string }];
    const rows = await q
      .selectAll('u')
      .orderBy('u.created_at', 'desc')
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
      .execute();
    const roles = rows.length
      ? await db.selectFrom('role_assignments').select(['user_id', 'role']).where('user_id', 'in', rows.map((r) => r.id)).where('revoked_at', 'is', null).execute()
      : [];
    return {
      items: rows.map((u) => userDto(u, roles.filter((r) => r.user_id === u.id))),
      page: f.page,
      pageSize: f.pageSize,
      total: Number(total),
    };
  });

  app.get('/users/:id', { config: { permission: 'user.read' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const user = await loadUser(db, id);
    const roles = await db
      .selectFrom('role_assignments as ra')
      .leftJoin('organisations as o', 'o.id', 'ra.organisation_id')
      .leftJoin('centres as c', 'c.id', 'ra.centre_id')
      .leftJoin('users as g', 'g.id', 'ra.granted_by')
      .select(['ra.id', 'ra.role', 'ra.organisation_id', 'o.legal_name as organisation_name', 'ra.centre_id', 'c.name as centre_name', 'ra.granted_at', 'g.name as granted_by_name', 'ra.revoked_at'])
      .where('ra.user_id', '=', id)
      .orderBy('ra.granted_at', 'desc')
      .execute();
    const pendingInvite = await db
      .selectFrom('invitations')
      .select(['expires_at'])
      .where('user_id', '=', id)
      .where('accepted_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    return {
      ...userDto(user, roles.filter((r) => !r.revoked_at)),
      inviteExpiresAt: iso(pendingInvite?.expires_at),
      roleAssignments: roles.map((r) => ({
        id: r.id,
        role: r.role,
        organisationId: r.organisation_id,
        organisationName: r.organisation_name,
        centreId: r.centre_id,
        centreName: r.centre_name,
        grantedAt: iso(r.granted_at),
        grantedByName: r.granted_by_name,
        revokedAt: iso(r.revoked_at),
      })),
    };
  });

  /** F-08: invite a user. An initial role may be given only by someone who can assign roles. */
  app.post('/users', { config: { permission: 'user.invite' } }, async (req, reply) => {
    const body = parse(inviteSchema, req.body);
    const actor = req.actor!;
    if (body.role) assertPermission(actor, 'role.assign');
    const fields: Record<string, string> = {};
    if (body.email && (await db.selectFrom('users').select('id').where('email', '=', body.email).executeTakeFirst())) fields.email = 'Already in use';
    if (body.phone && (await db.selectFrom('users').select('id').where('phone', '=', body.phone).executeTakeFirst())) fields.phone = 'Already in use';
    if (Object.keys(fields).length) throw conflict('A user with these details already exists', fields);

    const id = newId();
    let token: string | null = null;
    await db.transaction().execute(async (trx) => {
      const user = { id, name: body.name, email: body.email ?? null, phone: body.phone ?? null, status: 'invited' as const };
      await trx.insertInto('users').values(user).execute();
      await audit(trx, auditCtx(req), { action: 'user.invited', entityType: 'user', entityId: id, after: user });
      if (body.role) await grantRole(trx, req, { ...body.role, userId: id });
      if (body.email) token = await createInvitation(trx, id, actor.userId);
    });

    if (token && body.email) await app.providers.email.sendInvitation(body.email, body.name, inviteLink(token));
    reply.code(201);
    return {
      id,
      status: 'invited',
      signInMethod: body.email ? 'email_invitation' : 'phone_otp',
      // Local development only: no email vendor yet, so the link is returned to the admin.
      devInviteUrl: app.providers.devEcho && token ? inviteLink(token) : undefined,
    };
  });

  app.post('/users/:id/resend-invitation', { config: { permission: 'user.invite' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const user = await loadUser(db, id);
    if (user.status !== 'invited') throw invalid('Only invited users can be sent a new invitation.');
    if (!user.email) throw invalid('This user signs in with a phone code and has no invitation link.');
    const token = await createInvitation(db, id, req.actor!.userId);
    await audit(db, auditCtx(req), { action: 'user.invitation_resent', entityType: 'user', entityId: id });
    await app.providers.email.sendInvitation(user.email, user.name, inviteLink(token));
    return { ok: true, devInviteUrl: app.providers.devEcho ? inviteLink(token) : undefined };
  });

  /** Status transitions. Each is audited; suspend and deactivate end all sessions at once (SEC-10). */
  const transitions = [
    { path: 'approve', action: 'user.approved', permission: 'user.approve', from: ['pending'], to: 'active', needsReason: false },
    { path: 'suspend', action: 'user.suspended', permission: 'user.suspend', from: ['active', 'invited', 'pending'], to: 'suspended', needsReason: true },
    { path: 'reactivate', action: 'user.reactivated', permission: 'user.suspend', from: ['suspended'], to: 'active', needsReason: false },
    { path: 'deactivate', action: 'user.deactivated', permission: 'user.deactivate', from: ['invited', 'pending', 'active', 'suspended'], to: 'deactivated', needsReason: true },
  ] as const;

  for (const t of transitions) {
    app.post(`/users/:id/${t.path}`, { config: { permission: t.permission } }, async (req) => {
      const { id } = parse(idParam, req.params);
      const reason = t.needsReason ? parse(reasonSchema, req.body).reason : undefined;
      const user = await loadUser(db, id);
      await assertCanManage(db, req.actor!, user);
      if (!(t.from as readonly string[]).includes(user.status)) {
        throw invalid(`A user who is ${user.status} cannot be moved to ${t.to}.`);
      }
      // A reactivated user who never finished signing up goes back to invited.
      const to = t.path === 'reactivate' && !user.password_hash && !user.phone_verified_at ? 'invited' : t.to;
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('users').set({ status: to, updated_at: new Date() }).where('id', '=', id).execute();
        await audit(trx, auditCtx(req), {
          action: t.action,
          entityType: 'user',
          entityId: id,
          before: { status: user.status },
          after: { status: to, reason },
        });
      });
      if (to === 'suspended' || to === 'deactivated') await revokeUserSessions(db, id);
      return { id, status: to };
    });
  }

  /**
   * Phase 11: change the mobile number a learner or trainer signs in with (they lost the old one).
   * VTA records how it checked who they are. Every session ends at once and the person must sign in
   * with a code sent to the new number; old codes for the old number stop working.
   */
  app.post('/users/:id/phone', { config: { permission: 'user.suspend' } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(changePhoneSchema, req.body);
    const user = await loadUser(db, id);
    await assertCanManage(db, req.actor!, user);
    if (!user.phone) throw invalid('This person signs in with email, not a mobile number.');
    if (user.phone === b.phone) throw invalid('That is already their number.', { phone: 'Same as now' });
    if (await db.selectFrom('users').select('id').where('phone', '=', b.phone).where('id', '!=', id).executeTakeFirst()) {
      throw conflict('Another account already uses this number', { phone: 'Already in use' });
    }
    const masked = (p: string) => `${p.slice(0, 5)}*****${p.slice(-2)}`;
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ phone: b.phone, phone_verified_at: null, updated_at: new Date() }).where('id', '=', id).execute();
      await trx.deleteFrom('otp_challenges').where('phone', 'in', [user.phone!, b.phone]).execute();
      await audit(trx, auditCtx(req), { action: 'user.phone_changed', entityType: 'user', entityId: id, before: { phone: masked(user.phone!) }, after: { phone: masked(b.phone), reason: b.reason } });
      await notify(trx, [id], 'phone_changed', { phone: masked(b.phone) }, null);
    });
    await revokeUserSessions(db, id);
    return { id, phone: b.phone };
  });


  app.get('/users-summary', { config: { permission: 'user.read' } }, async () => {
    const rows = await db
      .selectFrom('users')
      .select(['status', sql<string>`count(*)`.as('n')])
      .groupBy('status')
      .execute();
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  });
};
