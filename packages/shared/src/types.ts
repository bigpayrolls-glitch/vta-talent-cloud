import type { Portal, Role } from './roles.js';

export type UserStatus = 'invited' | 'pending' | 'active' | 'suspended' | 'deactivated';
export type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'more_info_needed';

export interface RoleAssignmentDto {
  id: string;
  role: Role;
  organisationId: string | null;
  organisationName: string | null;
  centreId: string | null;
  centreName: string | null;
  grantedAt: string;
}

export interface MeDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  roles: RoleAssignmentDto[];
  portals: Portal[];
  csrfToken: string;
  /** Signs in with email and password (so can change or reset it). Phone sign-in accounts have none. */
  hasPassword: boolean;
  /** Learners who have not accepted the current privacy notice and terms (Phase 5). */
  consentRequired?: boolean;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: {
    code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INTERNAL';
    message: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
}
