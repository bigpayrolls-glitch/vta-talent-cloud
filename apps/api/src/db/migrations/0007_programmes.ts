import { sql, type Kysely } from 'kysely';

/**
 * Phase 7: partner programmes (AD-10, PA-01 to PA-06).
 * - organisations.programme_interests (PA-01).
 * - programmes: target cohort, dates, approved beneficiary fields and the basis for sharing them, an optional
 *   budget reference recorded with its source and date (never presented as finance data).
 * - programme_partners: which partner organisations may see a programme (PA-02).
 * - programme_batches: the batches whose enrolments make up the programme cohort.
 * - documents.programme_id + category: programme documents (PA-05).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE organisations ADD COLUMN programme_interests text;

    CREATE TYPE programme_status AS ENUM ('planned','active','closed');
    CREATE TABLE programmes (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      description text,
      sponsor_organisation_id uuid REFERENCES organisations(id),
      target_count integer NOT NULL CHECK (target_count > 0),
      start_date date NOT NULL,
      end_date date NOT NULL,
      status programme_status NOT NULL DEFAULT 'planned',
      reporting_requirements text,
      beneficiary_fields text[] NOT NULL,
      sharing_basis text,
      budget_reference text,
      budget_amount bigint CHECK (budget_amount >= 0),
      budget_source text,
      budget_as_of date,
      created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT programme_dates CHECK (end_date >= start_date),
      -- Personal fields may be shared only with a recorded basis.
      CONSTRAINT programme_sensitive_basis CHECK (NOT (beneficiary_fields && ARRAY['name','phone','dateOfBirth']) OR sharing_basis IS NOT NULL),
      CONSTRAINT programme_budget_source CHECK (budget_amount IS NULL OR (budget_source IS NOT NULL AND budget_as_of IS NOT NULL))
    );

    CREATE TABLE programme_partners (
      programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
      organisation_id uuid NOT NULL REFERENCES organisations(id),
      PRIMARY KEY (programme_id, organisation_id)
    );
    CREATE INDEX programme_partners_org_idx ON programme_partners (organisation_id);

    CREATE TABLE programme_batches (
      programme_id uuid NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
      batch_id uuid NOT NULL REFERENCES batches(id),
      PRIMARY KEY (programme_id, batch_id)
    );
    CREATE INDEX programme_batches_batch_idx ON programme_batches (batch_id);

    ALTER TABLE documents
      ADD COLUMN programme_id uuid REFERENCES programmes(id),
      ADD COLUMN category text CHECK (category IN ('work_order','attendance_summary','report','evidence','other'));
    CREATE INDEX documents_programme_idx ON documents (programme_id) WHERE programme_id IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS documents_programme_idx;
    ALTER TABLE documents DROP COLUMN IF EXISTS programme_id, DROP COLUMN IF EXISTS category;
    DROP TABLE IF EXISTS programme_batches, programme_partners, programmes CASCADE;
    DROP TYPE IF EXISTS programme_status;
    ALTER TABLE organisations DROP COLUMN IF EXISTS programme_interests;
  `.execute(db);
}
