import { sql, type Kysely } from 'kysely';

/**
 * Phase 13: public course catalogue and learner self-enrolment. A course can have a fee (no GST for now);
 * a learner who pays (or joins a free course) is enrolled at once if seats are left. Payments are only ever added.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE courses ADD COLUMN fee_paise integer NOT NULL DEFAULT 0 CHECK (fee_paise >= 0);
    ALTER TABLE enrolments ADD COLUMN source text NOT NULL DEFAULT 'centre' CHECK (source IN ('centre', 'self'));

    CREATE SEQUENCE enrolment_receipt_seq;

    CREATE TABLE course_payments (
      id uuid PRIMARY KEY,
      enrolment_id uuid NOT NULL REFERENCES enrolments(id),
      candidate_id uuid NOT NULL REFERENCES users(id),
      batch_id uuid NOT NULL REFERENCES batches(id),
      amount_paise integer NOT NULL CHECK (amount_paise >= 0),
      currency text NOT NULL DEFAULT 'INR',
      method text CHECK (method IN ('upi', 'card', 'netbanking')),
      provider text NOT NULL CHECK (provider IN ('test', 'free')),
      status text NOT NULL CHECK (status IN ('succeeded')),
      receipt_number text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX course_payments_candidate_idx ON course_payments (candidate_id, created_at DESC);
    CREATE INDEX course_payments_enrolment_idx ON course_payments (enrolment_id);

    CREATE FUNCTION course_payments_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'course_payments is append-only';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER course_payments_no_change BEFORE UPDATE OR DELETE ON course_payments
      FOR EACH ROW EXECUTE FUNCTION course_payments_append_only();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS course_payments;
    DROP FUNCTION IF EXISTS course_payments_append_only();
    DROP SEQUENCE IF EXISTS enrolment_receipt_seq;
    ALTER TABLE enrolments DROP COLUMN IF EXISTS source;
    ALTER TABLE courses DROP COLUMN IF EXISTS fee_paise;
  `.execute(db);
}
