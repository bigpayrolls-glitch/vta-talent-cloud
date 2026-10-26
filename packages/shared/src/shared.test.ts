import { describe, expect, it } from 'vitest';
import { hasPermission, PERMISSIONS } from './permissions.js';
import { portalsForRoles, ROLE_PORTAL, ROLE_SCOPE, ROLES } from './roles.js';
import { phoneSchema, passwordSchema } from './schemas.js';

describe('roles and portals', () => {
  it('every role belongs to exactly one of the four portals', () => {
    for (const r of ROLES) expect(['admin', 'employer', 'learn', 'partner']).toContain(ROLE_PORTAL[r]);
  });

  it('trainers work inside the Training Partner portal (design decision, 24 Oct 2026)', () => {
    expect(ROLE_PORTAL.trainer).toBe('partner');
    expect(ROLE_SCOPE.trainer).toEqual({ organisation: 'partner', centre: true, organisationFromCentre: true });
  });

  it('a multi-role user gets each portal once, in a fixed order', () => {
    expect(portalsForRoles(['partner_viewer', 'ops_admin', 'super_admin'])).toEqual(['admin', 'partner']);
  });
});

describe('permissions', () => {
  it('only a Super Admin assigns roles or deactivates users', () => {
    expect(PERMISSIONS['role.assign']).toEqual(['super_admin']);
    expect(PERMISSIONS['user.deactivate']).toEqual(['super_admin']);
  });

  it('no employer, partner, trainer or learner role holds any admin permission', () => {
    const outside = ['employer_admin', 'employer_recruiter', 'partner_admin', 'partner_viewer', 'trainer', 'learner'] as const;
    const adminPerms = ['dashboard.read', 'user.read', 'user.invite', 'user.approve', 'user.suspend', 'user.deactivate', 'role.assign', 'organisation.manage', 'organisation.verify', 'centre.manage', 'audit.read'] as const;
    for (const role of outside) for (const p of adminPerms) expect(hasPermission([role], p), `${role} ${p}`).toBe(false);
  });
});

describe('input rules', () => {
  it('normalises Indian mobile numbers to +91 form', () => {
    expect(phoneSchema.parse('98765 43210')).toBe('+919876543210');
    expect(phoneSchema.parse('+91 98765-43210')).toBe('+919876543210');
    expect(phoneSchema.safeParse('12345').success).toBe(false);
    expect(phoneSchema.safeParse('5876543210').success).toBe(false);
  });

  it('requires passwords of at least 10 characters', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('long-enough-1').success).toBe(true);
  });
});
