import { audit } from '../audit/service.js';
import { newId } from '../lib/crypto.js';
import type { EmailProvider } from '../lib/providers.js';
import { createInvitation } from '../routes/admin/users.js';
import type { DB } from './index.js';

/**
 * A new live database has no one to sign in. On the first production deploy, if there are no users yet and
 * FIRST_ADMIN_EMAIL is set, one Admin is created and emailed an invitation link (valid 7 days) to set a password.
 * Returns what happened, for the build log. Never runs again once anyone exists.
 */
export async function createFirstAdmin(db: DB, opts: { email?: string; name?: string; origin: string; email_: EmailProvider }): Promise<string> {
  const email = opts.email?.trim().toLowerCase();
  const { n } = await db.selectFrom('users').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
  if (Number(n) > 0) return 'Users already exist; no first Admin created.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'No users yet. Set FIRST_ADMIN_EMAIL (and FIRST_ADMIN_NAME) and redeploy to create the first Admin.';
  const name = opts.name?.trim() || 'Admin';
  const id = newId();
  const token = await db.transaction().execute(async (trx) => {
    await trx.insertInto('users').values({ id, name, email, phone: null, status: 'invited' }).execute();
    await trx.insertInto('role_assignments').values({ id: newId(), user_id: id, role: 'super_admin', granted_by: null }).execute();
    await audit(trx, { actorId: null, requestId: null, ip: null }, { action: 'user.first_admin_created', entityType: 'user', entityId: id, after: { email, name, role: 'super_admin' } });
    return createInvitation(trx as unknown as DB, id, id);
  });
  await opts.email_.sendInvitation(email, name, `${opts.origin}/invite/${token}`);
  return `First Admin created for ${email}; an invitation email has been sent (valid 7 days).`;
}
