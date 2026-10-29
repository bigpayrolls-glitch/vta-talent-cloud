import { sql, type Kysely } from 'kysely';
import { PARTNER_PLAN_INFO } from '@vta/shared';

/**
 * 29 Oct 2026: training partner plans (Free, Professional, Institution) with Subscription & Billing.
 * A partner's plan uses the same subscription and payment tables as employers; GST is now recorded on each
 * payment (gst_paise, included in amount_paise). Partner plans start from AutoTalent Grid's design and can be
 * changed in Admin > Plans.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE employer_subscriptions
      DROP CONSTRAINT employer_subscriptions_plan_check,
      ADD CONSTRAINT employer_subscriptions_plan_check CHECK (plan IN ('starter', 'growth', 'enterprise', 'professional', 'institution'));
    ALTER TABLE subscription_payments
      DROP CONSTRAINT subscription_payments_plan_check,
      ADD CONSTRAINT subscription_payments_plan_check CHECK (plan IN ('starter', 'growth', 'professional', 'institution')),
      ADD COLUMN gst_paise integer NOT NULL DEFAULT 0 CHECK (gst_paise >= 0);
    ALTER TABLE payment_orders
      DROP CONSTRAINT payment_orders_plan_check,
      ADD CONSTRAINT payment_orders_plan_check CHECK (plan IN ('starter', 'growth', 'professional', 'institution')),
      ADD COLUMN gst_paise integer NOT NULL DEFAULT 0;
  `.execute(db);
  for (const [code, info] of Object.entries(PARTNER_PLAN_INFO)) {
    await sql`INSERT INTO plan_catalogue (audience, code, info) VALUES ('partner', ${code}, ${JSON.stringify(info)}::jsonb) ON CONFLICT DO NOTHING`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM plan_catalogue WHERE audience = 'partner';
    ALTER TABLE payment_orders DROP COLUMN IF EXISTS gst_paise;
    ALTER TABLE subscription_payments DROP COLUMN IF EXISTS gst_paise;
  `.execute(db);
}
