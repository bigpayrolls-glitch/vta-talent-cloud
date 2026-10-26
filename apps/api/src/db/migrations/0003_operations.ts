import { sql, type Kysely } from 'kysely';

/**
 * Phase 3: training operations (plan backlog R-01 to R-06).
 * Attendance, practical assessment results with criterion scores, and completion credentials.
 * Completion (attendance), assessment pass and credential issue are kept as separate states (requirements §13).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE attendance_status AS ENUM ('present','absent','late','excused');
    CREATE TYPE result_status AS ENUM ('draft','submitted','returned','approved','rejected');
    CREATE TYPE criterion_outcome AS ENUM ('pass','fail','not_assessed');
    CREATE TYPE credential_status AS ENUM ('active','revoked','superseded');

    CREATE TABLE attendance_sessions (
      id uuid PRIMARY KEY,
      batch_id uuid NOT NULL REFERENCES batches(id),
      session_date date NOT NULL,
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (batch_id, session_date)
    );

    CREATE TABLE attendance_records (
      id uuid PRIMARY KEY,
      session_id uuid NOT NULL REFERENCES attendance_sessions(id),
      candidate_id uuid NOT NULL REFERENCES users(id),
      status attendance_status NOT NULL,
      captured_by uuid NOT NULL REFERENCES users(id),
      -- Offline sync (Phase 4) sends a client operation id so retries never duplicate.
      client_op_id uuid UNIQUE,
      client_captured_at timestamptz,
      received_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (session_id, candidate_id)
    );
    CREATE INDEX attendance_candidate_idx ON attendance_records (candidate_id);

    CREATE TABLE assessment_results (
      id uuid PRIMARY KEY,
      enrolment_id uuid NOT NULL REFERENCES enrolments(id),
      status result_status NOT NULL DEFAULT 'draft',
      total_score integer NOT NULL DEFAULT 0,
      max_score integer NOT NULL,
      outcome text CHECK (outcome IN ('pass','fail')),
      trainer_comment text,
      recorded_by uuid NOT NULL REFERENCES users(id),
      submitted_by uuid REFERENCES users(id),
      submitted_at timestamptz,
      reviewed_by uuid REFERENCES users(id),
      reviewed_at timestamptz,
      review_reason text,
      released_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- The person who submitted a result can never be the one who approves it.
      CONSTRAINT result_reviewer_differs CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by)
    );
    -- One live result per enrolment. A rejected result is kept for the record and a reassessment starts a new one.
    CREATE UNIQUE INDEX assessment_one_live_result ON assessment_results (enrolment_id) WHERE status <> 'rejected';
    CREATE INDEX assessment_status_idx ON assessment_results (status);

    CREATE TABLE assessment_scores (
      id uuid PRIMARY KEY,
      result_id uuid NOT NULL REFERENCES assessment_results(id),
      criterion_id uuid NOT NULL REFERENCES assessment_criteria(id),
      score integer CHECK (score >= 0),
      outcome criterion_outcome NOT NULL DEFAULT 'not_assessed',
      comment text,
      UNIQUE (result_id, criterion_id)
    );

    CREATE TABLE credentials (
      id uuid PRIMARY KEY,
      candidate_id uuid NOT NULL REFERENCES users(id),
      course_id uuid NOT NULL REFERENCES courses(id),
      enrolment_id uuid NOT NULL REFERENCES enrolments(id),
      result_id uuid NOT NULL REFERENCES assessment_results(id),
      credential_type text NOT NULL DEFAULT 'course_completion' CHECK (credential_type IN ('course_completion')),
      holder_name text NOT NULL,
      course_title text NOT NULL,
      issue_date date NOT NULL,
      issuer_name text NOT NULL,
      verification_code text NOT NULL UNIQUE,
      status credential_status NOT NULL DEFAULT 'active',
      revoked_reason text,
      revoked_by uuid REFERENCES users(id),
      revoked_at timestamptz,
      superseded_by uuid REFERENCES credentials(id),
      issued_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- At most one active credential per enrolment.
    CREATE UNIQUE INDEX credential_one_active ON credentials (enrolment_id) WHERE status = 'active';
    CREATE INDEX credential_candidate_idx ON credentials (candidate_id);

    -- Completion is decided from attendance when a batch is marked completed.
    ALTER TABLE enrolments ADD COLUMN attendance_pct numeric(5,2);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE enrolments DROP COLUMN IF EXISTS attendance_pct;
    DROP TABLE IF EXISTS credentials, assessment_scores, assessment_results, attendance_records, attendance_sessions CASCADE;
    DROP TYPE IF EXISTS credential_status, criterion_outcome, result_status, attendance_status;
  `.execute(db);
}
