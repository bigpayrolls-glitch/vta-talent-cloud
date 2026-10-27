import type { NotificationTemplate, Role } from '@vta/shared';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/types.js';
import { newId } from './crypto.js';

type Executor = Kysely<Database> | Transaction<Database>;

/**
 * SH-07: records in-app notifications. Call it inside the same transaction as the change it reports,
 * so a notification never describes something that was rolled back.
 * `link` is a path inside the web app (for example /learn/applications/<id>).
 * The person who made the change is never notified about it.
 */
export async function notify(
  db: Executor,
  userIds: readonly (string | null | undefined)[],
  template: NotificationTemplate,
  params: Record<string, string | number | null | undefined>,
  link: string | null,
  opts: { except?: string | null } = {},
): Promise<void> {
  const recipients = [...new Set(userIds.filter((u): u is string => !!u && u !== opts.except))];
  if (!recipients.length) return;
  const clean = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v == null ? '' : String(v)]));
  await db
    .insertInto('notifications')
    .values(recipients.map((user_id) => ({ id: newId(), user_id, template, params: JSON.stringify(clean), link })))
    .execute();
}

/** Active members of an organisation with one of these roles. */
export async function orgMembers(db: Executor, organisationId: string, roles: readonly Role[]): Promise<string[]> {
  const rows = await db
    .selectFrom('role_assignments as ra')
    .innerJoin('users as u', 'u.id', 'ra.user_id')
    .select('u.id')
    .where('ra.organisation_id', '=', organisationId)
    .where('ra.role', 'in', roles)
    .where('ra.revoked_at', 'is', null)
    .where('u.status', '=', 'active')
    .execute();
  return rows.map((r) => r.id);
}

export const EMPLOYER_TEAM: readonly Role[] = ['employer_admin'];
export const PARTNER_TEAM: readonly Role[] = ['partner_admin'];

/** VTA staff who act on verification and review queues. */
export async function vtaReviewers(db: Executor): Promise<string[]> {
  const rows = await db
    .selectFrom('role_assignments as ra')
    .innerJoin('users as u', 'u.id', 'ra.user_id')
    .select('u.id')
    .where('ra.role', '=', 'super_admin')
    .where('ra.revoked_at', 'is', null)
    .where('u.status', '=', 'active')
    .execute();
  return rows.map((r) => r.id);
}
