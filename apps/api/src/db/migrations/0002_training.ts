import { sql, type Kysely } from 'kysely';

/**
 * Phase 2: training master data (plan §4.2–4.3, backlog T-01 to T-06).
 * Courses and assessment criteria, trainer profiles, candidate profiles, batches,
 * enrolments and private documents.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TYPE skill_area AS ENUM ('2W','4W','EV','CV','other');
    CREATE TYPE candidate_status AS ENUM ('pending','verified','rejected','needs_correction');
    CREATE TYPE batch_status AS ENUM ('planned','active','completed','cancelled');
    CREATE TYPE enrolment_status AS ENUM ('enrolled','withdrawn','completed','not_completed');

    CREATE TABLE courses (
      id uuid PRIMARY KEY,
      code text UNIQUE,
      title text NOT NULL,
      skill_area skill_area NOT NULL,
      level text NOT NULL CHECK (level IN ('beginner','intermediate','advanced','beginner_to_advanced')),
      delivery_mode text NOT NULL CHECK (delivery_mode IN ('classroom','online','blended')),
      duration_value integer NOT NULL CHECK (duration_value > 0),
      duration_unit text NOT NULL CHECK (duration_unit IN ('days','weeks','months')),
      training_hours integer CHECK (training_hours > 0),
      prerequisites text,
      description text,
      attendance_threshold_pct integer NOT NULL CHECK (attendance_threshold_pct BETWEEN 0 AND 100),
      pass_mark_pct integer NOT NULL CHECK (pass_mark_pct BETWEEN 0 AND 100),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX courses_skill_idx ON courses (skill_area, status);

    CREATE TABLE assessment_criteria (
      id uuid PRIMARY KEY,
      course_id uuid NOT NULL REFERENCES courses(id),
      label text NOT NULL,
      max_score integer NOT NULL CHECK (max_score > 0),
      required boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (course_id, sort_order)
    );

    CREATE TABLE trainer_profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id),
      specialisations text[] NOT NULL DEFAULT '{}' CHECK (specialisations <@ ARRAY['2W','4W','EV','CV','other']),
      verification_status verification_status NOT NULL DEFAULT 'pending',
      verification_reason text,
      verified_by uuid REFERENCES users(id),
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- Human-readable candidate codes: VTA2600001 (year + sequence).
    CREATE SEQUENCE candidate_code_seq START 1;

    CREATE TABLE candidate_profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id),
      candidate_code text NOT NULL UNIQUE,
      city text NOT NULL,
      state text,
      skill_areas text[] NOT NULL DEFAULT '{}' CHECK (skill_areas <@ ARRAY['2W','4W','EV','CV','other']),
      experience_months integer NOT NULL DEFAULT 0 CHECK (experience_months >= 0),
      education text,
      languages text[] NOT NULL DEFAULT '{}',
      availability text,
      -- Hidden from employer search until the candidate opts in (Phase 5, PRV-03).
      searchable boolean NOT NULL DEFAULT false,
      verification_status candidate_status NOT NULL DEFAULT 'pending',
      verification_reason text,
      verified_by uuid REFERENCES users(id),
      verified_at timestamptz,
      -- Possible duplicate (same name + date of birth). Cleared when an admin reviews it.
      duplicate_of uuid REFERENCES users(id),
      source text NOT NULL CHECK (source IN ('admin','import','self')),
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX candidate_status_idx ON candidate_profiles (verification_status);
    CREATE INDEX candidate_city_idx ON candidate_profiles (lower(city));
    CREATE INDEX candidate_dup_idx ON candidate_profiles (duplicate_of) WHERE duplicate_of IS NOT NULL;
    CREATE INDEX users_name_dob_idx ON users (lower(name), date_of_birth);

    CREATE TABLE batches (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      course_id uuid NOT NULL REFERENCES courses(id),
      centre_id uuid NOT NULL REFERENCES centres(id),
      trainer_id uuid NOT NULL REFERENCES users(id),
      start_date date NOT NULL,
      end_date date NOT NULL,
      capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 500),
      status batch_status NOT NULL DEFAULT 'planned',
      cancel_reason text,
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT batch_dates CHECK (end_date >= start_date)
    );
    CREATE INDEX batches_centre_idx ON batches (centre_id, status);
    CREATE INDEX batches_trainer_idx ON batches (trainer_id, status);
    CREATE INDEX batches_course_idx ON batches (course_id);

    CREATE TABLE enrolments (
      id uuid PRIMARY KEY,
      candidate_id uuid NOT NULL REFERENCES users(id),
      batch_id uuid NOT NULL REFERENCES batches(id),
      status enrolment_status NOT NULL DEFAULT 'enrolled',
      enrolled_at timestamptz NOT NULL DEFAULT now(),
      enrolled_by uuid REFERENCES users(id),
      withdrawn_at timestamptz,
      withdraw_reason text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (candidate_id, batch_id)
    );
    CREATE INDEX enrolments_batch_idx ON enrolments (batch_id, status);

    CREATE TABLE documents (
      id uuid PRIMARY KEY,
      owner_user_id uuid NOT NULL REFERENCES users(id),
      kind text NOT NULL CHECK (kind IN ('certificate','experience_letter','photo','other')),
      title text NOT NULL,
      storage_key text NOT NULL UNIQUE,
      original_name text NOT NULL,
      mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
      size_bytes integer NOT NULL CHECK (size_bytes > 0),
      sha256 text NOT NULL,
      verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
      -- No scanning service yet (decision D10). Files stay 'not_scanned' until one is chosen.
      scan_status text NOT NULL DEFAULT 'not_scanned' CHECK (scan_status IN ('not_scanned','clean','infected')),
      uploaded_by uuid REFERENCES users(id),
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX documents_owner_idx ON documents (owner_user_id) WHERE deleted_at IS NULL;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS documents, enrolments, batches, candidate_profiles, trainer_profiles, assessment_criteria, courses CASCADE;
    DROP INDEX IF EXISTS users_name_dob_idx;
    DROP SEQUENCE IF EXISTS candidate_code_seq;
    DROP TYPE IF EXISTS enrolment_status, batch_status, candidate_status, skill_area;
  `.execute(db);
}
