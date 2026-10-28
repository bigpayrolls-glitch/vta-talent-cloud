import type { Role } from './roles.js';

/**
 * Permission registry. Every API route names one of these (or is marked public).
 * The server is the only place they are enforced; the web app uses the same list
 * only to decide what to show.
 */
export const PERMISSIONS = {
  // Signed-in basics
  'self.read': ['super_admin', 'employer_admin', 'learner', 'partner_admin', 'trainer'],

  // Admin portal
  'dashboard.read': ['super_admin'],
  'user.read': ['super_admin'],
  'user.invite': ['super_admin'],
  'user.approve': ['super_admin'],
  'user.suspend': ['super_admin'],
  'user.deactivate': ['super_admin'],
  'role.assign': ['super_admin'],
  'organisation.manage': ['super_admin'],
  'organisation.verify': ['super_admin'],
  'centre.manage': ['super_admin'],
  'audit.read': ['super_admin'],

  // Scoped reads used by every portal (results are filtered by policy scope)
  'organisation.read': ['super_admin', 'employer_admin', 'partner_admin', 'trainer'],
  'organisation.members.read': ['super_admin', 'employer_admin', 'partner_admin'],
  'centre.read': ['super_admin', 'partner_admin', 'trainer'],

  // Phase 2: training master data
  'course.read': ['super_admin', 'partner_admin', 'trainer'],
  'course.manage': ['super_admin'],
  /** Training partners write their own courses and send them for review. Only their organisation's courses (checked per record). */
  'course.author': ['partner_admin'],
  /** Approving, returning or rejecting courses that training partners submitted. */
  'course.review': ['super_admin'],
  'trainer.read': ['super_admin', 'partner_admin'],
  /** Adding trainers and assigning them to centres. Training partners only at their own centres (checked per record). */
  'trainer.manage': ['super_admin', 'partner_admin'],
  /** Verifying trainers, including independent ones who signed up themselves. */
  'trainer.verify': ['super_admin'],
  'candidate.read': ['super_admin', 'partner_admin'],
  'candidate.manage': ['super_admin'],
  /** Batch reads are scoped: admins all, training partners their centres, trainers their own batches. */
  'batch.read': ['super_admin', 'partner_admin', 'trainer'],
  /** Creating batches and enrolling candidates. Training partners only at their own centres. */
  'batch.manage': ['super_admin', 'partner_admin'],
  'document.upload': ['super_admin'],
  /** Getting a download link. The record-level check happens in the files route. */
  'document.read': ['super_admin', 'partner_admin'],

  // Phase 3: training operations
  /** Recording attendance and assessments: only the trainer assigned to the batch (checked per batch). */
  'attendance.record': ['trainer'],
  /** Phase 5: a learner's own profile, documents, consents, learning, results and certificates. */
  'learner.self': ['learner'],
  'assessment.record': ['trainer'],
  /** Authorised reviewers (AD-06). Never the person who submitted the result (enforced per result). */
  'assessment.review': ['super_admin'],
  'credential.issue': ['super_admin'],
  'credential.revoke': ['super_admin'],
  'credential.read': ['super_admin', 'partner_admin'],

  // Phase 6: employers and hiring. Every employer route is limited to the actor's own organisation.
  /** Company profile, verification documents and team (EM-01, EM-02). */
  'employer.company': ['employer_admin'],
  /** Read the company profile. */
  'employer.company.read': ['employer_admin'],
  'job.manage': ['employer_admin'],
  'application.manage': ['employer_admin'],
  /** EM-04: only verified employers, only candidates who opted in. */
  'candidate.search': ['employer_admin'],
  /** AD-09 job moderation and EM-08 joining follow-up. */
  'job.moderate': ['super_admin'],
  'hiring.verify': ['super_admin'],
  'hiring.read': ['super_admin'],
  /** Phase 12: the employer's plan. */
  'employer.subscription.read': ['employer_admin'],
  'employer.subscription': ['employer_admin'],
  /** AutoTalent Grid sets a plan by hand (Enterprise, or paid outside the platform). */
  'subscription.manage': ['super_admin'],

  // Phase 7: partner programmes and reports. Partners see only programmes assigned to their organisation.
  /** PA-01: the partner's own organisation profile and documents. */
  'partner.profile': ['partner_admin'],
  'partner.profile.read': ['partner_admin'],
  'programme.manage': ['super_admin'],
  'programme.read': ['super_admin', 'partner_admin'],
  /** PA-05: programme documents. VTA staff and the assigned partner's admins. */
  'programme.documents.upload': ['super_admin', 'partner_admin'],
  /** AD-11: platform reports and exports. */
  'report.read': ['super_admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function rolesFor(permission: Permission): readonly Role[] {
  return PERMISSIONS[permission];
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return roles.some((r) => allowed.includes(r));
}
