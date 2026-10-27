/**
 * Roles, portals and the scope each role must carry.
 * Source: requirements §4, plan §6.1 and design decisions of 24 Oct 2026 (§10):
 * four portals; trainers work inside the Training Partner portal.
 */

/**
 * Five logins (decision of 27 Oct 2026): Admin (everything), Employer, Learner, Trainer and Training Partner.
 * The internal keys are kept so existing records and audit history stay readable. Earlier roles
 * (Operations Admin, Centre Admin, Recruiter, Partner Viewer) were folded in by migration 0014.
 */
export const ROLES = ['super_admin', 'employer_admin', 'learner', 'partner_admin', 'trainer'] as const;
export type Role = (typeof ROLES)[number];

export const PORTALS = ['admin', 'employer', 'learn', 'partner'] as const;
export type Portal = (typeof PORTALS)[number];

export const ROLE_PORTAL: Record<Role, Portal> = {
  super_admin: 'admin',
  employer_admin: 'employer',
  learner: 'learn',
  partner_admin: 'partner',
  trainer: 'partner',
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Admin',
  employer_admin: 'Employer',
  learner: 'Learner',
  partner_admin: 'Training Partner',
  trainer: 'Trainer',
};

export const PORTAL_LABEL: Record<Portal, string> = {
  admin: 'Admin Portal',
  employer: 'Employer Portal',
  learn: 'Learner Portal',
  partner: 'Training Partner Portal',
};

export type OrgType = 'vta' | 'employer' | 'partner';

/**
 * What scope a role assignment must (or must not) carry. Enforced when granting.
 * `organisationFromCentre`: the organisation is taken from the centre's owner, so a trainer
 * at a partner centre belongs to that partner and a trainer at a VTA-run centre belongs to none.
 */
export const ROLE_SCOPE: Record<
  Role,
  { organisation: OrgType | null; centre: boolean; organisationFromCentre?: boolean; centreOptional?: boolean }
> = {
  super_admin: { organisation: null, centre: false },
  employer_admin: { organisation: 'employer', centre: false },
  learner: { organisation: null, centre: false },
  partner_admin: { organisation: 'partner', centre: false },
  // A trainer works at a centre; an independent (freelance) trainer has no centre until assigned to a batch.
  trainer: { organisation: 'partner', centre: true, organisationFromCentre: true, centreOptional: true },
};

/** Roles whose sessions use the short staff idle timeout (SEC-09). */
export const STAFF_ROLES: readonly Role[] = ['super_admin', 'employer_admin'];

export function portalsForRoles(roles: readonly Role[]): Portal[] {
  const set = new Set(roles.map((r) => ROLE_PORTAL[r]));
  return PORTALS.filter((p) => set.has(p));
}
