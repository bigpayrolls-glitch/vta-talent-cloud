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

const PLATFORM_ROLES: readonly Role[] = ['super_admin'];

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

/** Centres run by the training partner(s) the actor administers. */
export async function partnerCentres(db: DB, actor: Actor): Promise<string[]> {
  const orgs = unique(actor.assignments.filter((a) => a.role === 'partner_admin').map((a) => a.organisationId));
  if (!orgs.length) return [];
  return (await db.selectFrom('centres').select('id').where('organisation_id', 'in', orgs).execute()).map((c) => c.id);
}

/**
 * Centres the actor may read:
 * - admins: all
 * - training partners: every centre their organisation runs
 * - trainers: the centres they are assigned to
 */
export async function centreScope(db: DB, actor: Actor): Promise<Scope> {
  if (isPlatformAdmin(actor)) return 'all';
  const direct = actor.assignments.filter((a) => a.role === 'trainer').map((a) => a.centreId);
  return unique([...direct, ...(await partnerCentres(db, actor))]);
}

/** Organisations whose member list the actor may read: admins, or the organisation's own login. */
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
// Batches, candidates, trainers
// ---------------------------------------------------------------------------

/**
 * Batches the actor may READ:
 * - admins: all
 * - training partners: batches at centres their organisation runs
 * - trainers: only batches assigned to them, at centres where they still hold the trainer role (TR-01)
 */
export type BatchScope = 'all' | { centreIds: string[]; trainer: { userId: string; centreIds: string[] } | null };

export async function batchReadScope(db: DB, actor: Actor): Promise<BatchScope> {
  if (isPlatformAdmin(actor)) return 'all';
  const trainerCentres = unique(actor.assignments.filter((a) => a.role === 'trainer').map((a) => a.centreId));
  return {
    centreIds: await partnerCentres(db, actor),
    trainer: trainerCentres.length ? { userId: actor.userId, centreIds: trainerCentres } : null,
  };
}

/** Centres where the actor may CREATE or CHANGE batches and enrolments: admins all, training partners their own. */
export async function batchManageScope(db: DB, actor: Actor): Promise<Scope> {
  if (isPlatformAdmin(actor)) return 'all';
  return partnerCentres(db, actor);
}

export function batchVisible(scope: BatchScope, batch: { centre_id: string; trainer_id: string }): boolean {
  if (scope === 'all') return true;
  if (scope.centreIds.includes(batch.centre_id)) return true;
  return !!scope.trainer && batch.trainer_id === scope.trainer.userId && scope.trainer.centreIds.includes(batch.centre_id);
}

/** True when the actor may see candidates' phone numbers on a roster: admins, the partner running the centre, the batch's trainer. */
export async function rosterShowsContact(db: DB, actor: Actor, batch: { centre_id: string; trainer_id: string }): Promise<boolean> {
  if (isPlatformAdmin(actor)) return true;
  if ((await partnerCentres(db, actor)).includes(batch.centre_id)) return true;
  return batch.trainer_id === actor.userId;
}

/**
 * Candidates whose full record the actor may read:
 * - admins: all ('all')
 * - training partners: candidates with any enrolment at their centres (returned as an id list)
 */
export async function candidateReadScope(db: DB, actor: Actor): Promise<Scope> {
  if (isPlatformAdmin(actor)) return 'all';
  const centres = await partnerCentres(db, actor);
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

/**
 * Trainers the actor may list: admins all; training partners their organisation's trainers plus verified
 * independent trainers (no centre yet), so they can be assigned to the partner's batches.
 */
export async function trainerReadScope(db: DB, actor: Actor): Promise<Scope> {
  if (isPlatformAdmin(actor)) return 'all';
  const orgs = unique(actor.assignments.filter((a) => a.role === 'partner_admin').map((a) => a.organisationId));
  if (!orgs.length) return [];
  const own = await db.selectFrom('role_assignments').select('user_id').distinct().where('role', '=', 'trainer').where('revoked_at', 'is', null).where('organisation_id', 'in', orgs).execute();
  const independent = await db
    .selectFrom('role_assignments as ra')
    .innerJoin('trainer_profiles as tp', 'tp.user_id', 'ra.user_id')
    .select('ra.user_id')
    .distinct()
    .where('ra.role', '=', 'trainer')
    .where('ra.revoked_at', 'is', null)
    .where('ra.centre_id', 'is', null)
    .where('tp.verification_status', '=', 'verified')
    .execute();
  return unique([...own.map((r) => r.user_id), ...independent.map((r) => r.user_id)]);
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((x): x is string => !!x))];
}
