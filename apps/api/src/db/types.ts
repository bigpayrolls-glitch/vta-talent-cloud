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
  purpose: 'login' | 'register';
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
  sector: ColumnType<string | null, string | null | undefined, string | null>;
  city: ColumnType<string | null, string | null | undefined, string | null>;
  website: ColumnType<string | null, string | null | undefined, string | null>;
  description: ColumnType<string | null, string | null | undefined, string | null>;
  duplicate_of: ColumnType<string | null, string | null | undefined, string | null>;
  submitted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  programme_interests: ColumnType<string | null, string | null | undefined, string | null>;
  registration_source: ColumnType<'vta' | 'self', 'vta' | 'self' | undefined, 'vta' | 'self'>;
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
  preferred_work_area: ColumnType<string | null, string | null | undefined, string | null>;
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
  visibility: Generated<'private' | 'employers'>;
  organisation_id: ColumnType<string | null, string | null | undefined, string | null>;
  programme_id: ColumnType<string | null, string | null | undefined, string | null>;
  category: ColumnType<string | null, string | null | undefined, string | null>;
  uploaded_by: string | null;
  reviewed_by: ColumnType<string | null, string | null | undefined, string | null>;
  reviewed_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  review_reason: ColumnType<string | null, string | null | undefined, string | null>;
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

export type JobStatus = 'draft' | 'pending_review' | 'published' | 'paused' | 'closed' | 'rejected';
export type ApplicationStatus = 'applied' | 'shortlisted' | 'interview' | 'offer' | 'joined' | 'not_joined' | 'rejected' | 'withdrawn';

export interface NotificationsTable {
  id: string;
  user_id: string;
  template: string;
  params: Json<Record<string, string>>;
  link: string | null;
  channel: Generated<'in_app' | 'sms' | 'email' | 'whatsapp'>;
  delivery_state: Generated<'pending' | 'delivered' | 'failed' | 'skipped'>;
  read_at: Date | null;
  created_at: Timestamp;
}

export interface EmployerSubscriptionsTable {
  organisation_id: string;
  plan: 'starter' | 'growth' | 'enterprise';
  billing_cycle: 'monthly' | 'yearly' | null;
  period_start: Date;
  period_end: Date;
  source: 'payment' | 'admin';
  updated_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SubscriptionPaymentsTable {
  id: string;
  organisation_id: string;
  plan: 'starter' | 'growth';
  billing_cycle: 'monthly' | 'yearly';
  amount_paise: number;
  currency: Generated<string>;
  method: 'card' | 'upi' | 'netbanking';
  provider: 'test';
  status: 'succeeded';
  invoice_number: string;
  period_start: Date;
  period_end: Date;
  paid_by: string;
  created_at: Timestamp;
}

export interface PasswordResetsTable {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Timestamp;
}

export interface AccountRequestsTable {
  id: string;
  user_id: string;
  kind: 'closure';
  reason: string | null;
  status: Generated<'open' | 'completed' | 'declined' | 'cancelled'>;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Timestamp;
}

export interface StoredFilesTable {
  key: string;
  data: Buffer;
  created_at: Timestamp;
}

export interface ProgrammesTable {
  id: string;
  name: string;
  description: string | null;
  sponsor_organisation_id: string | null;
  target_count: number;
  start_date: ColumnType<string, string, string>;
  end_date: ColumnType<string, string, string>;
  status: Generated<'planned' | 'active' | 'closed'>;
  reporting_requirements: string | null;
  beneficiary_fields: TextArray;
  sharing_basis: string | null;
  budget_reference: string | null;
  budget_amount: ColumnType<string | null, number | null | undefined, number | null>;
  budget_source: string | null;
  budget_as_of: ColumnType<string | null, string | null | undefined, string | null>;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ProgrammePartnersTable {
  programme_id: string;
  organisation_id: string;
}

export interface ProgrammeBatchesTable {
  programme_id: string;
  batch_id: string;
}

export interface JobsTable {
  id: string;
  organisation_id: string;
  title: string;
  skill_area: SkillArea;
  skills: TextArray;
  min_experience_months: number;
  city: string;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  openings: number;
  shift: string | null;
  description: string;
  closing_date: ColumnType<string, string, string>;
  vta_certificate_preferred: boolean;
  status: Generated<JobStatus>;
  moderation_reason: string | null;
  moderated_by: string | null;
  moderated_at: Date | null;
  created_by: string;
  submitted_at: Date | null;
  published_at: Date | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface JobApplicationsTable {
  id: string;
  job_id: string;
  candidate_id: string;
  status: Generated<ApplicationStatus>;
  consent_snapshot: Json<Record<string, unknown>>;
  note: string | null;
  joining_date: ColumnType<string | null, string | null | undefined, string | null>;
  outcome_verification: Generated<'unverified' | 'verified' | 'flagged'>;
  outcome_note: string | null;
  outcome_reviewed_by: string | null;
  outcome_reviewed_at: Date | null;
  applied_at: Timestamp;
  updated_at: Timestamp;
}

export interface ApplicationEventsTable {
  id: string;
  application_id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  actor_id: string | null;
  actor_kind: 'candidate' | 'employer' | 'vta';
  created_at: Timestamp;
}

export interface InterviewsTable {
  id: string;
  application_id: string;
  scheduled_at: Date;
  mode: 'in_person' | 'phone' | 'video';
  location: string | null;
  outcome: Generated<'scheduled' | 'passed' | 'failed' | 'no_show' | 'cancelled'>;
  internal_notes: string | null;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface JobInvitationsTable {
  id: string;
  job_id: string;
  candidate_id: string;
  invited_by: string;
  message: string | null;
  created_at: Timestamp;
}

export interface ConsentEventsTable {
  id: string;
  user_id: string;
  purpose: 'privacy_notice' | 'terms' | 'profile_searchable';
  granted: boolean;
  notice_version: string | null;
  recorded_by: string | null;
  source: 'self' | 'staff' | 'migration';
  created_at: Timestamp;
}

export interface AttendanceSyncOpsTable {
  op_id: string;
  user_id: string;
  batch_id: string;
  outcome: 'applied' | 'unchanged' | 'conflict' | 'rejected';
  message: string | null;
  captured_at: Date;
  received_at: Timestamp;
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
  attendance_sync_ops: AttendanceSyncOpsTable;
  consent_events: ConsentEventsTable;
  jobs: JobsTable;
  programmes: ProgrammesTable;
  stored_files: StoredFilesTable;
  notifications: NotificationsTable;
  password_resets: PasswordResetsTable;
  employer_subscriptions: EmployerSubscriptionsTable;
  subscription_payments: SubscriptionPaymentsTable;
  account_requests: AccountRequestsTable;
  programme_partners: ProgrammePartnersTable;
  programme_batches: ProgrammeBatchesTable;
  job_applications: JobApplicationsTable;
  application_events: ApplicationEventsTable;
  interviews: InterviewsTable;
  job_invitations: JobInvitationsTable;
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
export type Job = Selectable<JobsTable>;
export type JobApplication = Selectable<JobApplicationsTable>;
export type Programme = Selectable<ProgrammesTable>;
