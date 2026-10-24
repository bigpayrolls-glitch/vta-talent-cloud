import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { OrgType, Role, UserStatus, VerificationStatus } from '@vta/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T> = ColumnType<T, string | undefined, string>;

export interface UsersTable {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  date_of_birth: string | null;
  status: UserStatus;
  failed_login_count: Generated<number>;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  idle_timeout_seconds: number;
  last_seen_at: Timestamp;
  expires_at: Date;
  revoked_at: Date | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Timestamp;
}

export interface OtpChallengesTable {
  id: string;
  phone: string;
  code_hash: string;
  purpose: 'login';
  expires_at: Date;
  attempts: Generated<number>;
  consumed_at: Date | null;
  ip: string | null;
  created_at: Timestamp;
}

export interface InvitationsTable {
  id: string;
  user_id: string;
  token_hash: string;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Timestamp;
}

export interface OrganisationsTable {
  id: string;
  type: OrgType;
  partner_subtype: string | null;
  legal_name: string;
  registration_ids: Json<Record<string, string>>;
  address: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  verification_status: VerificationStatus;
  verification_reason: string | null;
  verified_by: string | null;
  verified_at: Date | null;
  status: 'active' | 'inactive';
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CentresTable {
  id: string;
  organisation_id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  contact_phone: string | null;
  status: 'active' | 'inactive';
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RoleAssignmentsTable {
  id: string;
  user_id: string;
  role: Role;
  organisation_id: string | null;
  centre_id: string | null;
  programme_id: string | null;
  granted_by: string | null;
  granted_at: Timestamp;
  revoked_by: string | null;
  revoked_at: Date | null;
}

export interface AuditEventsTable {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  before: Json<Record<string, unknown> | null>;
  after: Json<Record<string, unknown> | null>;
  ip: string | null;
  created_at: Timestamp;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  otp_challenges: OtpChallengesTable;
  invitations: InvitationsTable;
  organisations: OrganisationsTable;
  centres: CentresTable;
  role_assignments: RoleAssignmentsTable;
  audit_events: AuditEventsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Organisation = Selectable<OrganisationsTable>;
export type Centre = Selectable<CentresTable>;
export type RoleAssignment = Selectable<RoleAssignmentsTable>;
