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
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: {
    code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL';
    message: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
}
