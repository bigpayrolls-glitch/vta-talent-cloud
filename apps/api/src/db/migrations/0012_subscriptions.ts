import { sql, type Kysely } from 'kysely';

/**
 * Phase 12: employer plans. One current subscription per employer (no row, or a lapsed one, means Free) and a
 * record of every payment with its invoice number. Payments are only ever added, never changed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE employer_subscriptions (
      organisation_id uuid PRIMARY KEY REFERENCES organisations(id),
      plan text NOT NULL CHECK (plan IN ('starter', 'growth', 'enterprise')),
      billing_cycle text CHECK (billing_cycle IN ('monthly', 'yearly')),
      period_start timestamptz NOT NULL,
      period_end timestamptz NOT NULL CHECK (period_end > period_start),
      source text NOT NULL CHECK (source IN ('payment', 'admin')),
      updated_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE SEQUENCE invoice_number_seq;

    CREATE TABLE subscription_payments (
      id uuid PRIMARY KEY,
      organisation_id uuid NOT NULL REFERENCES organisations(id),
      plan text NOT NULL CHECK (plan IN ('starter', 'growth')),
      billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
      amount_paise integer NOT NULL CHECK (amount_paise > 0),
      currency text NOT NULL DEFAULT 'INR',
      method text NOT NULL CHECK (method IN ('card', 'upi', 'netbanking')),
      provider text NOT NULL CHECK (provider IN ('test')),
      status text NOT NULL CHECK (status IN ('succeeded')),
      invoice_number text NOT NULL UNIQUE,
      period_start timestamptz NOT NULL,
      period_end timestamptz NOT NULL,
      paid_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX subscription_payments_org_idx ON subscription_payments (organisation_id, created_at DESC);

    CREATE FUNCTION subscription_payments_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'subscription_payments is append-only';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER subscription_payments_no_change BEFORE UPDATE OR DELETE ON subscription_payments
      FOR EACH ROW EXECUTE FUNCTION subscription_payments_append_only();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS subscription_payments;
    DROP FUNCTION IF EXISTS subscription_payments_append_only();
    DROP SEQUENCE IF EXISTS invoice_number_seq;
    DROP TABLE IF EXISTS employer_subscriptions;
  `.execute(db);
}
