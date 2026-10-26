import { sql, type Kysely } from 'kysely';

/**
 * Phase 5: Learner portal.
 * - consent_events: every consent given or withdrawn, never edited (SH-05). Current state = newest row per purpose.
 * - documents.visibility: private, or visible to employers the person shares their profile with (EE-03).
 * - candidate_profiles.preferred_work_area (EE-02).
 * - otp_challenges.purpose gains 'register' (self-registration, EE-01).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE consent_events (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id),
      purpose text NOT NULL CHECK (purpose IN ('privacy_notice','terms','profile_searchable')),
      granted boolean NOT NULL,
      notice_version text,
      -- Who recorded it: the person themselves, or staff acting on a written request.
      recorded_by uuid REFERENCES users(id),
      source text NOT NULL CHECK (source IN ('self','staff','migration')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX consent_user_idx ON consent_events (user_id, purpose, created_at DESC);

    CREATE FUNCTION consent_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'consent_events is append-only'; END;
    $$;
    CREATE TRIGGER consent_events_no_update BEFORE UPDATE OR DELETE ON consent_events
      FOR EACH ROW EXECUTE FUNCTION consent_events_immutable();
    CREATE TRIGGER consent_events_no_truncate BEFORE TRUNCATE ON consent_events
      FOR EACH STATEMENT EXECUTE FUNCTION consent_events_immutable();

    ALTER TABLE documents ADD COLUMN visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','employers'));
    ALTER TABLE candidate_profiles ADD COLUMN preferred_work_area text;

    ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
    ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('login','register'));

    -- Profiles already marked searchable before consent records existed get a matching record.
    INSERT INTO consent_events (id, user_id, purpose, granted, source)
      SELECT gen_random_uuid(), user_id, 'profile_searchable', true, 'migration' FROM candidate_profiles WHERE searchable;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
    ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('login'));
    ALTER TABLE candidate_profiles DROP COLUMN IF EXISTS preferred_work_area;
    ALTER TABLE documents DROP COLUMN IF EXISTS visibility;
    DROP TABLE IF EXISTS consent_events;
    DROP FUNCTION IF EXISTS consent_events_immutable();
  `.execute(db);
}
