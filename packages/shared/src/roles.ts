/**
 * Roles, portals and the scope each role must carry.
 * Source: requirements §4, plan §6.1 and design decisions of 24 Oct 2026 (§10):
 * four portals; trainers work inside the Training Partner portal.
 */

export const ROLES = [
  'super_admin',
  'ops_admin',
  'centre_admin',
  'employer_admin',
  'employer_recruiter',
  'learner',
  'partner_admin',
  'partner_viewer',
  'trainer',
] as const;
export type Role = (typeof ROLES)[number];

export const PORTALS = ['admin', 'employer', 'learn', 'partner'] as const;
export type Portal = (typeof PORTALS)[number];

export const ROLE_PORTAL: Record<Role, Portal> = {
  super_admin: 'admin',
  ops_admin: 'admin',
  centre_admin: 'admin',
  employer_admin: 'employer',
  employer_recruiter: 'employer',
  learner: 'learn',
  partner_admin: 'partner',
  partner_viewer: 'partner',
  trainer: 'partner',
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  ops_admin: 'Operations Admin',
  centre_admin: 'Centre Admin',
  employer_admin: 'Employer Admin',
  employer_recruiter: 'Recruiter',
  learner: 'Learner',
  partner_admin: 'Partner Admin',
  partner_viewer: 'Partner Viewer',
  trainer: 'Trainer',
};

export const PORTAL_LABEL: Record<Portal, string> = {
  admin: 'Admin Portal',
  employer: 'Employer Portal',
  learn: 'Learner Portal',
  partner: 'Training Partner Portal',
};

export type OrgType = 'vta' | 'employer' | 'partner';

/** What scope a role assignment must (or must not) carry. Enforced when granting. */
export const ROLE_SCOPE: Record<
  Role,
  { organisation: OrgType | null; centre: boolean }
> = {
  super_admin: { organisation: null, centre: false },
  ops_admin: { organisation: null, centre: false },
  centre_admin: { organisation: null, centre: true },
  employer_admin: { organisation: 'employer', centre: false },
  employer_recruiter: { organisation: 'employer', centre: false },
  learner: { organisation: null, centre: false },
  partner_admin: { organisation: 'partner', centre: false },
  partner_viewer: { organisation: 'partner', centre: false },
  trainer: { organisation: 'partner', centre: true },
};

/** Roles whose sessions use the short staff idle timeout (SEC-09). */
export const STAFF_ROLES: readonly Role[] = [
  'super_admin',
  'ops_admin',
  'centre_admin',
  'employer_admin',
  'employer_recruiter',
];

export function portalsForRoles(roles: readonly Role[]): Portal[] {
  const set = new Set(roles.map((r) => ROLE_PORTAL[r]));
  return PORTALS.filter((p) => set.has(p));
}
