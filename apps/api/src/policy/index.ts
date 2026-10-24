import { hasPermission, type Permission, type Role } from '@vta/shared';
import type { DB } from '../db/index.js';
import { forbidden } from '../lib/errors.js';

/**
 * The policy module (plan §3.3) is the ONLY place access is decided.
 * - Route level: every route names a Permission (checked in app.ts before the handler runs).
 * - Record level: services ask this module for a query scope and apply it to every lookup.
 *   Out-of-scope records are reported as "not found" so their existence is not revealed (SEC-02).
 */

export interface Assignment {
  role: Role;
  organisationId: string | null;
  centreId: string | null;
}

export interface Actor {
  userId: string;
  name: string;
  sessionId: string;
  csrfToken: string;
  assignments: Assignment[];
  roles: Role[];
}

const PLATFORM_ROLES: readonly Role[] = ['super_admin', 'ops_admin'];

export const isPlatformAdmin = (a: Actor): boolean => a.roles.some((r) => PLATFORM_ROLES.includes(r));
export const isSuperAdmin = (a: Actor): boolean => a.roles.includes('super_admin');

export function assertPermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.roles, permission)) throw forbidden();
}

/** 'all' = no restriction. Otherwise the explicit list of ids the actor may see (possibly empty). */
export type Scope = 'all' | string[];

/** Organisations the actor may read: platform admins all; others only orgs they hold a role in. */
export function organisationScope(actor: Actor): Scope {
  if (isPlatformAdmin(actor)) return 'all';
  return unique(actor.assignments.map((a) => a.organisationId));
}

/**
 * Centres the actor may read:
 * - platform admins: all
 * - centre admin / trainer: their assigned centres
 * - partner admin / viewer: every centre owned by their partner organisation
 */
export async function centreScope(db: DB, actor: Actor): Promise<Scope> {
  if (isPlatformAdmin(actor)) return 'all';
  const direct = actor.assignments
    .filter((a) => a.role === 'centre_admin' || a.role === 'trainer')
    .map((a) => a.centreId);
  const partnerOrgs = unique(
    actor.assignments.filter((a) => a.role === 'partner_admin' || a.role === 'partner_viewer').map((a) => a.organisationId),
  );
  let owned: string[] = [];
  if (partnerOrgs.length) {
    owned = (await db.selectFrom('centres').select('id').where('organisation_id', 'in', partnerOrgs).execute()).map((c) => c.id);
  }
  return unique([...direct, ...owned]);
}

/** Organisations whose member list the actor may read: platform admins, or admins of that org. */
export function memberListScope(actor: Actor): Scope {
  if (isPlatformAdmin(actor)) return 'all';
  return unique(
    actor.assignments
      .filter((a) => a.role === 'employer_admin' || a.role === 'partner_admin')
      .map((a) => a.organisationId),
  );
}

export const inScope = (scope: Scope, id: string): boolean => scope === 'all' || scope.includes(id);

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((x): x is string => !!x))];
}
