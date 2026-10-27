import { sql, type Kysely } from 'kysely';

/**
 * Razorpay payments for employer plans and course fees.
 * - payment_orders: one row per Razorpay order we create; it moves from created to paid (or failed, or
 *   needs_refund when a course seat was gone by the time the payment arrived). The only payment table that changes.
 * - Paid plans and enrolments are still recorded in the append-only subscription_payments / course_payments,
 *   now with provider 'razorpay' and Razorpay's payment id (unique, so a payment is never counted twice).
 * - payment_webhook_events: Razorpay event ids already handled, so a repeated webhook does nothing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE subscription_payments DROP CONSTRAINT subscription_payments_provider_check,
      ADD CONSTRAINT subscription_payments_provider_check CHECK (provider IN ('test', 'razorpay')),
      DROP CONSTRAINT subscription_payments_method_check,
      ADD CONSTRAINT subscription_payments_method_check CHECK (method IN ('card', 'upi', 'netbanking', 'wallet', 'other')),
      ADD COLUMN provider_payment_id text UNIQUE;
    ALTER TABLE course_payments DROP CONSTRAINT course_payments_provider_check,
      ADD CONSTRAINT course_payments_provider_check CHECK (provider IN ('test', 'free', 'razorpay')),
      DROP CONSTRAINT course_payments_method_check,
      ADD CONSTRAINT course_payments_method_check CHECK (method IN ('upi', 'card', 'netbanking', 'wallet', 'other')),
      ADD COLUMN provider_payment_id text UNIQUE;

    CREATE TABLE payment_orders (
      id uuid PRIMARY KEY,
      purpose text NOT NULL CHECK (purpose IN ('plan', 'course')),
      provider_order_id text NOT NULL UNIQUE,
      amount_paise integer NOT NULL CHECK (amount_paise > 0),
      status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'needs_refund')),
      payer_id uuid NOT NULL REFERENCES users(id),
      organisation_id uuid REFERENCES organisations(id),
      plan text CHECK (plan IN ('starter', 'growth')),
      billing_cycle text CHECK (billing_cycle IN ('monthly', 'yearly')),
      batch_id uuid REFERENCES batches(id),
      provider_payment_id text UNIQUE,
      result_id uuid,
      failure text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      paid_at timestamptz,
      CHECK ((purpose = 'plan' AND organisation_id IS NOT NULL AND plan IS NOT NULL AND billing_cycle IS NOT NULL) OR (purpose = 'course' AND batch_id IS NOT NULL))
    );
    CREATE INDEX payment_orders_payer_idx ON payment_orders (payer_id, created_at DESC);

    CREATE TABLE payment_webhook_events (
      event_id text PRIMARY KEY,
      event_type text NOT NULL,
      outcome text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS payment_webhook_events;
    DROP TABLE IF EXISTS payment_orders;
    ALTER TABLE course_payments DROP COLUMN provider_payment_id;
    ALTER TABLE subscription_payments DROP COLUMN provider_payment_id;
  `.execute(db);
}
