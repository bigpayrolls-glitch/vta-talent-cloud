import { sql, type Kysely } from 'kysely';

/**
 * Training partners create their own courses; AutoTalent Grid reviews them before learners can see them.
 * - courses.owner_organisation_id: the training partner that wrote the course (null = an AutoTalent Grid course).
 * - courses.approval_status: draft -> submitted -> published, or changes_requested (back to the partner) or rejected.
 *   Every existing course was made by AutoTalent Grid, so it starts as published.
 *   A course is shown to learners only when it is published AND active (status stays the on/off switch).
 * - Wizard fields: category is skill_area; course_type, city, image, modules, skills, learning outcomes,
 *   GST and certificate type are new. first_batch holds the partner's planned first batch until the course
 *   is published, when it becomes a real batch.
 * - course_review_events: the history tab (submitted, changes requested, approved, rejected, resubmitted).
 * - batches.class_timings: free text such as "Mon–Sat, 10:00 AM – 1:00 PM".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE courses
      ADD COLUMN owner_organisation_id uuid REFERENCES organisations(id),
      ADD COLUMN approval_status text NOT NULL DEFAULT 'published'
        CHECK (approval_status IN ('draft', 'submitted', 'changes_requested', 'rejected', 'published')),
      ADD COLUMN course_type text CHECK (course_type IN ('certification', 'short_term', 'skill_upgrade')),
      ADD COLUMN city text,
      ADD COLUMN gst_pct integer NOT NULL DEFAULT 0 CHECK (gst_pct IN (0, 5, 12, 18, 28)),
      ADD COLUMN certificate_type text,
      ADD COLUMN image_key text,
      ADD COLUMN image_mime text CHECK (image_mime IN ('image/png', 'image/jpeg')),
      ADD COLUMN modules jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN skills text[] NOT NULL DEFAULT '{}',
      ADD COLUMN learning_outcomes text[] NOT NULL DEFAULT '{}',
      ADD COLUMN first_batch jsonb,
      ADD COLUMN review_note text,
      ADD COLUMN submitted_at timestamptz,
      ADD COLUMN reviewed_at timestamptz,
      ADD COLUMN reviewed_by uuid REFERENCES users(id),
      ADD COLUMN published_at timestamptz,
      ADD COLUMN created_by uuid REFERENCES users(id),
      DROP CONSTRAINT IF EXISTS courses_level_check,
      ADD CONSTRAINT courses_level_check CHECK (level IN ('beginner', 'intermediate', 'advanced', 'beginner_to_intermediate', 'beginner_to_advanced')),
      ADD CONSTRAINT courses_platform_published CHECK (owner_organisation_id IS NOT NULL OR approval_status = 'published');
    UPDATE courses SET published_at = created_at;
    CREATE INDEX courses_owner_idx ON courses (owner_organisation_id) WHERE owner_organisation_id IS NOT NULL;
    CREATE INDEX courses_review_idx ON courses (approval_status, submitted_at);

    CREATE TABLE course_review_events (
      id uuid PRIMARY KEY,
      course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      action text NOT NULL CHECK (action IN ('created', 'submitted', 'changes_requested', 'rejected', 'published', 'unpublished', 'republished')),
      note text,
      actor_id uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX course_review_events_course_idx ON course_review_events (course_id, created_at);

    ALTER TABLE batches ADD COLUMN class_timings text;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE batches DROP COLUMN IF EXISTS class_timings;
    DROP TABLE IF EXISTS course_review_events;
    ALTER TABLE courses
      DROP CONSTRAINT IF EXISTS courses_platform_published,
      DROP COLUMN IF EXISTS owner_organisation_id,
      DROP COLUMN IF EXISTS approval_status,
      DROP COLUMN IF EXISTS course_type,
      DROP COLUMN IF EXISTS city,
      DROP COLUMN IF EXISTS gst_pct,
      DROP COLUMN IF EXISTS certificate_type,
      DROP COLUMN IF EXISTS image_key,
      DROP COLUMN IF EXISTS image_mime,
      DROP COLUMN IF EXISTS modules,
      DROP COLUMN IF EXISTS skills,
      DROP COLUMN IF EXISTS learning_outcomes,
      DROP COLUMN IF EXISTS first_batch,
      DROP COLUMN IF EXISTS review_note,
      DROP COLUMN IF EXISTS submitted_at,
      DROP COLUMN IF EXISTS reviewed_at,
      DROP COLUMN IF EXISTS reviewed_by,
      DROP COLUMN IF EXISTS published_at,
      DROP COLUMN IF EXISTS created_by;
  `.execute(db);
}
