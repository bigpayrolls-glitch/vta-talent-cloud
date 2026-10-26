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

export type SkillArea = '2W' | '4W' | 'EV' | 'CV' | 'other';
type TextArray<T = string> = ColumnType<T[], T[] | undefined, T[]>;

export interface CoursesTable {
  id: string;
  code: string | null;
  title: string;
  skill_area: SkillArea;
  level: string;
  delivery_mode: string;
  duration_value: number;
  duration_unit: string;
  training_hours: number | null;
  prerequisites: string | null;
  description: string | null;
  attendance_threshold_pct: number;
  pass_mark_pct: number;
  status: 'active' | 'inactive';
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssessmentCriteriaTable {
  id: string;
  course_id: string;
  label: string;
  max_score: number;
  required: boolean;
  sort_order: number;
  created_at: Timestamp;
}

export interface TrainerProfilesTable {
  user_id: string;
  specialisations: TextArray<SkillArea>;
  verification_status: VerificationStatus;
  verification_reason: string | null;
  verified_by: string | null;
  verified_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type CandidateStatus = 'pending' | 'verified' | 'rejected' | 'needs_correction';

export interface CandidateProfilesTable {
  user_id: string;
  candidate_code: string;
  city: string;
  state: string | null;
  skill_areas: TextArray<SkillArea>;
  experience_months: number;
  education: string | null;
  languages: TextArray;
  availability: string | null;
  searchable: Generated<boolean>;
  verification_status: CandidateStatus;
  verification_reason: string | null;
  verified_by: string | null;
  verified_at: Date | null;
  duplicate_of: string | null;
  source: 'admin' | 'import' | 'self';
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type BatchStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface BatchesTable {
  id: string;
  name: string;
  course_id: string;
  centre_id: string;
  trainer_id: string;
  start_date: ColumnType<string, string, string>;
  end_date: ColumnType<string, string, string>;
  capacity: number;
  status: BatchStatus;
  cancel_reason: string | null;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type EnrolmentStatus = 'enrolled' | 'withdrawn' | 'completed' | 'not_completed';

export interface EnrolmentsTable {
  id: string;
  candidate_id: string;
  batch_id: string;
  status: EnrolmentStatus;
  enrolled_at: Timestamp;
  enrolled_by: string | null;
  withdrawn_at: Date | null;
  withdraw_reason: string | null;
  attendance_pct: ColumnType<string | null, number | null | undefined, number | null>;
  updated_at: Timestamp;
}

export interface DocumentsTable {
  id: string;
  owner_user_id: string;
  kind: string;
  title: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  verification_status: Generated<'pending' | 'verified' | 'rejected'>;
  scan_status: Generated<'not_scanned' | 'clean' | 'infected'>;
  uploaded_by: string | null;
  deleted_at: Date | null;
  created_at: Timestamp;
}

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type ResultStatus = 'draft' | 'submitted' | 'returned' | 'approved' | 'rejected';

export interface AttendanceSessionsTable {
  id: string;
  batch_id: string;
  session_date: ColumnType<string, string, string>;
  created_by: string | null;
  created_at: Timestamp;
}

export interface AttendanceRecordsTable {
  id: string;
  session_id: string;
  candidate_id: string;
  status: AttendanceStatus;
  captured_by: string;
  client_op_id: string | null;
  client_captured_at: Date | null;
  received_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssessmentResultsTable {
  id: string;
  enrolment_id: string;
  status: ResultStatus;
  total_score: number;
  max_score: number;
  outcome: 'pass' | 'fail' | null;
  trainer_comment: string | null;
  recorded_by: string;
  submitted_by: string | null;
  submitted_at: Date | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_reason: string | null;
  released_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AssessmentScoresTable {
  id: string;
  result_id: string;
  criterion_id: string;
  score: number | null;
  outcome: 'pass' | 'fail' | 'not_assessed';
  comment: string | null;
}

export interface CredentialsTable {
  id: string;
  candidate_id: string;
  course_id: string;
  enrolment_id: string;
  result_id: string;
  credential_type: Generated<'course_completion'>;
  holder_name: string;
  course_title: string;
  issue_date: ColumnType<string, string, string>;
  issuer_name: string;
  verification_code: string;
  status: 'active' | 'revoked' | 'superseded';
  revoked_reason: string | null;
  revoked_by: string | null;
  revoked_at: Date | null;
  superseded_by: string | null;
  issued_by: string;
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
  courses: CoursesTable;
  assessment_criteria: AssessmentCriteriaTable;
  trainer_profiles: TrainerProfilesTable;
  candidate_profiles: CandidateProfilesTable;
  batches: BatchesTable;
  enrolments: EnrolmentsTable;
  documents: DocumentsTable;
  attendance_sessions: AttendanceSessionsTable;
  attendance_records: AttendanceRecordsTable;
  assessment_results: AssessmentResultsTable;
  assessment_scores: AssessmentScoresTable;
  credentials: CredentialsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Organisation = Selectable<OrganisationsTable>;
export type Centre = Selectable<CentresTable>;
export type RoleAssignment = Selectable<RoleAssignmentsTable>;
export type Course = Selectable<CoursesTable>;
export type Batch = Selectable<BatchesTable>;
export type CandidateProfile = Selectable<CandidateProfilesTable>;
export type DocumentRow = Selectable<DocumentsTable>;
