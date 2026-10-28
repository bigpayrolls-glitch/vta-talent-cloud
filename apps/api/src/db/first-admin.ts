import { sql } from 'kysely';
import { audit } from '../audit/service.js';
import { newId } from '../lib/crypto.js';
import type { EmailProvider } from '../lib/providers.js';
import { createInvitation } from '../routes/admin/users.js';
import type { DB } from './index.js';

/**
 * Getting the first Admin into a live site. Runs on every production deploy, but only does anything while no
 * Admin has finished setting a password:
 * - FIRST_ADMIN_EMAIL already invited as Admin: a fresh invitation link is emailed (the earlier one stops working);
 * - a new FIRST_ADMIN_EMAIL (for example the first one was mistyped): that person is created as Admin and invited.
 * As soon as any Admin is active, it does nothing. Returns what happened, for the build log.
 */
export async function createFirstAdmin(db: DB, opts: { email?: string; name?: string; origin: string; email_: EmailProvider }): Promise<string> {
  const activeAdmin = await db
    .selectFrom('users as u')
    .innerJoin('role_assignments as r', 'r.user_id', 'u.id')
    .select('u.id')
    .where('r.role', '=', 'super_admin')
    .where('r.revoked_at', 'is', null)
    .where('u.status', '=', 'active')
    .executeTakeFirst();
  if (activeAdmin) return 'An Admin is already active; no first-Admin invitation sent.';
  const email = opts.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'No active Admin yet. Set FIRST_ADMIN_EMAIL (and FIRST_ADMIN_NAME) and redeploy to invite the first Admin.';
  const name = opts.name?.trim() || 'Admin';

  const existing = await db.selectFrom('users').select(['id', 'status']).where(sql`lower(email)`, '=', email).executeTakeFirst();
  let id = existing?.id;
  if (existing) {
    const isAdmin = await db.selectFrom('role_assignments').select('id').where('user_id', '=', existing.id).where('role', '=', 'super_admin').where('revoked_at', 'is', null).executeTakeFirst();
    if (!isAdmin || existing.status !== 'invited') return `${email} already belongs to another account. Choose a different FIRST_ADMIN_EMAIL.`;
  }
  const token = await db.transaction().execute(async (trx) => {
    if (!id) {
      id = newId();
      await trx.insertInto('users').values({ id, name, email, phone: null, status: 'invited' }).execute();
      await trx.insertInto('role_assignments').values({ id: newId(), user_id: id, role: 'super_admin', granted_by: null }).execute();
      await audit(trx, { actorId: null, requestId: null, ip: null }, { action: 'user.first_admin_created', entityType: 'user', entityId: id, after: { email, name, role: 'super_admin' } });
    } else {
      await audit(trx, { actorId: null, requestId: null, ip: null }, { action: 'user.first_admin_reinvited', entityType: 'user', entityId: id, after: { email } });
    }
    return createInvitation(trx as unknown as DB, id, id);
  });
  await opts.email_.sendInvitation(email, name, `${opts.origin}/invite/${token}`);
  return existing ? `Invitation sent again to the first Admin, ${email} (valid 7 days).` : `First Admin created for ${email}; an invitation email has been sent (valid 7 days).`;
}
