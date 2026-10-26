import { sql, type Kysely } from 'kysely';

/**
 * Phase 6: employers and hiring (EM-01 to EM-10, EE-07 to EE-09, AD-09).
 * - organisations: company profile fields, a possible-duplicate flag and when the employer sent it for checking.
 * - documents.organisation_id: company verification documents (uploaded by an employer admin).
 * - jobs, moderated by VTA before they are seen by learners.
 * - job_applications with a snapshot of what the learner agreed to share, one active application per job.
 * - application_events: the timeline (who moved it, when). interviews: with employer-only notes.
 * - job_invitations: an employer invites a searchable candidate to apply.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE organisations
      ADD COLUMN sector text,
      ADD COLUMN city text,
      ADD COLUMN website text,
      ADD COLUMN description text,
      ADD COLUMN duplicate_of uuid REFERENCES organisations(id),
      ADD COLUMN submitted_at timestamptz;

    ALTER TABLE documents ADD COLUMN organisation_id uuid REFERENCES organisations(id);
    CREATE INDEX documents_org_idx ON documents (organisation_id) WHERE organisation_id IS NOT NULL;

    CREATE TYPE job_status AS ENUM ('draft','pending_review','published','paused','closed','rejected');
    CREATE TABLE jobs (
      id uuid PRIMARY KEY,
      organisation_id uuid NOT NULL REFERENCES organisations(id),
      title text NOT NULL,
      skill_area text NOT NULL CHECK (skill_area IN ('2W','4W','EV','CV','other')),
      skills text[] NOT NULL DEFAULT '{}',
      min_experience_months integer NOT NULL DEFAULT 0 CHECK (min_experience_months >= 0),
      city text NOT NULL,
      location text,
      salary_min integer CHECK (salary_min >= 0),
      salary_max integer CHECK (salary_max >= 0),
      openings integer NOT NULL CHECK (openings BETWEEN 1 AND 500),
      shift text,
      description text NOT NULL,
      closing_date date NOT NULL,
      vta_certificate_preferred boolean NOT NULL DEFAULT false,
      status job_status NOT NULL DEFAULT 'draft',
      moderation_reason text,
      moderated_by uuid REFERENCES users(id),
      moderated_at timestamptz,
      created_by uuid NOT NULL REFERENCES users(id),
      submitted_at timestamptz,
      published_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT job_salary CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min)
    );
    CREATE INDEX jobs_org_idx ON jobs (organisation_id, status);
    CREATE INDEX jobs_open_idx ON jobs (status, closing_date) WHERE status = 'published';

    CREATE TYPE application_status AS ENUM ('applied','shortlisted','interview','offer','joined','not_joined','rejected','withdrawn');
    CREATE TABLE job_applications (
      id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES jobs(id),
      candidate_id uuid NOT NULL REFERENCES users(id),
      status application_status NOT NULL DEFAULT 'applied',
      -- What the learner agreed to share, exactly as shown to them when applying (EE-08, EM-10).
      consent_snapshot jsonb NOT NULL,
      note text,
      joining_date date,
      outcome_verification text NOT NULL DEFAULT 'unverified' CHECK (outcome_verification IN ('unverified','verified','flagged')),
      outcome_note text,
      outcome_reviewed_by uuid REFERENCES users(id),
      outcome_reviewed_at timestamptz,
      applied_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT joined_has_date CHECK (status <> 'joined' OR joining_date IS NOT NULL)
    );
    -- One active application per person per job (EE-08).
    CREATE UNIQUE INDEX one_active_application ON job_applications (job_id, candidate_id)
      WHERE status IN ('applied','shortlisted','interview','offer');
    CREATE INDEX applications_candidate_idx ON job_applications (candidate_id);
    CREATE INDEX applications_job_idx ON job_applications (job_id, status);

    CREATE TABLE application_events (
      id uuid PRIMARY KEY,
      application_id uuid NOT NULL REFERENCES job_applications(id),
      from_status application_status,
      to_status application_status NOT NULL,
      actor_id uuid REFERENCES users(id),
      actor_kind text NOT NULL CHECK (actor_kind IN ('candidate','employer','vta')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX application_events_idx ON application_events (application_id, created_at);

    CREATE TABLE interviews (
      id uuid PRIMARY KEY,
      application_id uuid NOT NULL REFERENCES job_applications(id),
      scheduled_at timestamptz NOT NULL,
      mode text NOT NULL CHECK (mode IN ('in_person','phone','video')),
      location text,
      outcome text NOT NULL DEFAULT 'scheduled' CHECK (outcome IN ('scheduled','passed','failed','no_show','cancelled')),
      -- Seen only by the employer's own team (EM-07); never sent to the learner or other employers.
      internal_notes text,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX interviews_application_idx ON interviews (application_id);

    CREATE TABLE job_invitations (
      id uuid PRIMARY KEY,
      job_id uuid NOT NULL REFERENCES jobs(id),
      candidate_id uuid NOT NULL REFERENCES users(id),
      invited_by uuid NOT NULL REFERENCES users(id),
      message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (job_id, candidate_id)
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS job_invitations, interviews, application_events, job_applications, jobs CASCADE;
    DROP TYPE IF EXISTS application_status, job_status;
    DROP INDEX IF EXISTS documents_org_idx;
    ALTER TABLE documents DROP COLUMN IF EXISTS organisation_id;
    ALTER TABLE organisations DROP COLUMN IF EXISTS sector, DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS website,
      DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS duplicate_of, DROP COLUMN IF EXISTS submitted_at;
  `.execute(db);
}
