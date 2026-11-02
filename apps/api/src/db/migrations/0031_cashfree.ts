import { sql, type Kysely } from 'kysely';

/**
 * 2 Nov 2026: Razorpay did not approve www.autotalentgrid.com on the PF Mitra account, so AutoTalent Grid opened
 * its own Cashfree Payments account. Payments can now come from either provider:
 * - payment_orders.provider says whose order it is (existing rows are Razorpay's);
 * - plan, course and career-journey payments may be recorded with provider 'cashfree'.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE payment_orders ADD COLUMN provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay', 'cashfree'));
    ALTER TABLE subscription_payments DROP CONSTRAINT subscription_payments_provider_check,
      ADD CONSTRAINT subscription_payments_provider_check CHECK (provider IN ('test', 'razorpay', 'cashfree'));
    ALTER TABLE course_payments DROP CONSTRAINT course_payments_provider_check,
      ADD CONSTRAINT course_payments_provider_check CHECK (provider IN ('test', 'free', 'razorpay', 'cashfree'));
    ALTER TABLE course_bookings DROP CONSTRAINT course_bookings_provider_check,
      ADD CONSTRAINT course_bookings_provider_check CHECK (provider IN ('test', 'free', 'razorpay', 'cashfree'));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE course_bookings DROP CONSTRAINT course_bookings_provider_check,
      ADD CONSTRAINT course_bookings_provider_check CHECK (provider IN ('test', 'free', 'razorpay'));
    ALTER TABLE course_payments DROP CONSTRAINT course_payments_provider_check,
      ADD CONSTRAINT course_payments_provider_check CHECK (provider IN ('test', 'free', 'razorpay'));
    ALTER TABLE subscription_payments DROP CONSTRAINT subscription_payments_provider_check,
      ADD CONSTRAINT subscription_payments_provider_check CHECK (provider IN ('test', 'razorpay'));
    ALTER TABLE payment_orders DROP COLUMN provider;
  `.execute(db);
}
