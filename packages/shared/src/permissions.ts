import type { Role } from './roles.js';

/**
 * Permission registry. Every API route names one of these (or is marked public).
 * The server is the only place they are enforced; the web app uses the same list
 * only to decide what to show.
 */
export const PERMISSIONS = {
  // Signed-in basics
  'self.read': ['super_admin', 'ops_admin', 'centre_admin', 'employer_admin', 'employer_recruiter', 'learner', 'partner_admin', 'partner_viewer', 'trainer'],

  // Admin portal
  'dashboard.read': ['super_admin', 'ops_admin', 'centre_admin'],
  'user.read': ['super_admin', 'ops_admin'],
  'user.invite': ['super_admin', 'ops_admin'],
  'user.approve': ['super_admin', 'ops_admin'],
  'user.suspend': ['super_admin', 'ops_admin'],
  'user.deactivate': ['super_admin'],
  'role.assign': ['super_admin'],
  'organisation.manage': ['super_admin', 'ops_admin'],
  'organisation.verify': ['super_admin', 'ops_admin'],
  'centre.manage': ['super_admin', 'ops_admin'],
  'audit.read': ['super_admin', 'ops_admin'],

  // Scoped reads used by every portal (results are filtered by policy scope)
  'organisation.read': ['super_admin', 'ops_admin', 'employer_admin', 'employer_recruiter', 'partner_admin', 'partner_viewer', 'trainer'],
  'organisation.members.read': ['super_admin', 'ops_admin', 'employer_admin', 'partner_admin'],
  'centre.read': ['super_admin', 'ops_admin', 'centre_admin', 'partner_admin', 'partner_viewer', 'trainer'],

  // Phase 2: training master data
  'course.read': ['super_admin', 'ops_admin', 'centre_admin', 'partner_admin', 'partner_viewer', 'trainer'],
  'course.manage': ['super_admin', 'ops_admin'],
  'trainer.read': ['super_admin', 'ops_admin', 'centre_admin', 'partner_admin'],
  'trainer.manage': ['super_admin', 'ops_admin'],
  'candidate.read': ['super_admin', 'ops_admin', 'centre_admin'],
  'candidate.manage': ['super_admin', 'ops_admin'],
  /** Batch reads are scoped: admins all, centre admins their centres, partners their centres, trainers their own batches. */
  'batch.read': ['super_admin', 'ops_admin', 'centre_admin', 'partner_admin', 'partner_viewer', 'trainer'],
  /** Creating batches and enrolling candidates. Centre admins only at their own centres. */
  'batch.manage': ['super_admin', 'ops_admin', 'centre_admin'],
  'document.upload': ['super_admin', 'ops_admin'],
  /** Getting a download link. The record-level check happens in the files route. */
  'document.read': ['super_admin', 'ops_admin', 'centre_admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function rolesFor(permission: Permission): readonly Role[] {
  return PERMISSIONS[permission];
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return roles.some((r) => allowed.includes(r));
}
