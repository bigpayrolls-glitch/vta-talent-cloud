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

// ---------------------------------------------------------------------------
// Phase 2 scopes: batches, candidates, trainers
// ---------------------------------------------------------------------------

/**
 * Batches the actor may READ:
 * - platform admins: all
 * - centre admins: batches at their centres
 * - partner admins / viewers: batches at centres their organisation runs
 * - trainers: only batches assigned to them, at centres where they still hold the trainer role (TR-01)
 */
export type BatchScope = 'all' | { centreIds: string[]; trainer: { userId: string; centreIds: string[] } | null };

export async function batchReadScope(db: DB, actor: Actor): Promise<BatchScope> {
  if (isPlatformAdmin(actor)) return 'all';
  const centreAdmin = actor.assignments.filter((a) => a.role === 'centre_admin').map((a) => a.centreId);
  const partnerOrgs = unique(
    actor.assignments.filter((a) => a.role === 'partner_admin' || a.role === 'partner_viewer').map((a) => a.organisationId),
  );
  let owned: string[] = [];
  if (partnerOrgs.length) {
    owned = (await db.selectFrom('centres').select('id').where('organisation_id', 'in', partnerOrgs).execute()).map((c) => c.id);
  }
  const trainerCentres = unique(actor.assignments.filter((a) => a.role === 'trainer').map((a) => a.centreId));
  return {
    centreIds: unique([...centreAdmin, ...owned]),
    trainer: trainerCentres.length ? { userId: actor.userId, centreIds: trainerCentres } : null,
  };
}

/** Centres where the actor may CREATE or CHANGE batches and enrolments. */
export function batchManageScope(actor: Actor): Scope {
  if (isPlatformAdmin(actor)) return 'all';
  return unique(actor.assignments.filter((a) => a.role === 'centre_admin').map((a) => a.centreId));
}

export function batchVisible(scope: BatchScope, batch: { centre_id: string; trainer_id: string }): boolean {
  if (scope === 'all') return true;
  if (scope.centreIds.includes(batch.centre_id)) return true;
  return !!scope.trainer && batch.trainer_id === scope.trainer.userId && scope.trainer.centreIds.includes(batch.centre_id);
}

/** True when the actor may see candidates' phone numbers on a roster (plan §6.1: trainers yes, partners no). */
export function rosterShowsContact(actor: Actor, batch: { centre_id: string; trainer_id: string }): boolean {
  if (isPlatformAdmin(actor)) return true;
  if (actor.assignments.some((a) => a.role === 'centre_admin' && a.centreId === batch.centre_id)) return true;
  return batch.trainer_id === actor.userId;
}

/**
 * Candidates whose full record the actor may read:
 * - platform admins: all ('all')
 * - centre admins: candidates with any enrolment at their centres (returned as an id list)
 */
export async function candidateReadScope(db: DB, actor: Actor): Promise<Scope> {
  if (isPlatformAdmin(actor)) return 'all';
  const centres = unique(actor.assignments.filter((a) => a.role === 'centre_admin').map((a) => a.centreId));
  if (!centres.length) return [];
  const rows = await db
    .selectFrom('enrolments as e')
    .innerJoin('batches as b', 'b.id', 'e.batch_id')
    .select('e.candidate_id')
    .distinct()
    .where('b.centre_id', 'in', centres)
    .execute();
  return rows.map((r) => r.candidate_id);
}

/** Trainers the actor may list: admins all; centre admins those at their centres; partner admins their organisation's. */
export async function trainerReadScope(db: DB, actor: Actor): Promise<Scope> {
  if (isPlatformAdmin(actor)) return 'all';
  const centres = unique(actor.assignments.filter((a) => a.role === 'centre_admin').map((a) => a.centreId));
  const orgs = unique(actor.assignments.filter((a) => a.role === 'partner_admin').map((a) => a.organisationId));
  if (!centres.length && !orgs.length) return [];
  let q = db.selectFrom('role_assignments').select('user_id').distinct().where('role', '=', 'trainer').where('revoked_at', 'is', null);
  q = q.where((eb) =>
    eb.or([
      ...(centres.length ? [eb('centre_id', 'in', centres)] : []),
      ...(orgs.length ? [eb('organisation_id', 'in', orgs)] : []),
    ]),
  );
  return (await q.execute()).map((r) => r.user_id);
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((x): x is string => !!x))];
}
