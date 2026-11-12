import type { FastifyInstance } from 'fastify';
import { audit, type AuditContext } from '../audit/service.js';
import { newId } from './crypto.js';
import { invalid } from './errors.js';
import { gatewayUnavailable, kindOf } from './razorpay.js';

/** What the browser needs to open the provider's Checkout for one order. */
export type OnlineCheckout = RazorpayCheckout | CashfreeCheckout;

export interface CashfreeCheckout {
  orderId: string;
  provider: 'cashfree';
  cashfree: { paymentSessionId: string; mode: 'production' | 'sandbox' };
}

export interface RazorpayCheckout {
  orderId: string;
  provider: 'razorpay';
  razorpay: {
    keyId: string;
    orderId: string;
    amount: number;
    currency: 'INR';
    name: string;
    description: string;
    prefill: { name?: string; email?: string; contact?: string };
  };
}

/** The last 10 digits of an Indian mobile number, or null. */
function mobile(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

/**
 * Creates the provider's order and our payment_orders row. Nothing is granted here: the plan or seat is given only
 * when the payment is verified (checked with the provider after Checkout, or a signed webhook) and matches this order.
 */
export async function startOnlineOrder(
  app: FastifyInstance,
  o: {
    purpose: 'plan' | 'course' | 'booking';
    amountPaise: number;
    payerId: string;
    organisationId?: string;
    plan?: 'starter' | 'growth' | 'professional' | 'institution';
    gstPaise?: number;
    cycle?: 'monthly' | 'yearly';
    batchId?: string;
    courseId?: string;
    needsStay?: boolean;
    description: string;
    prefill: { name?: string; email?: string; contact?: string };
    ctx: AuditContext;
  },
): Promise<OnlineCheckout> {
  const gateway = app.gateway;
  if (!gateway) throw gatewayUnavailable();
  const kind = kindOf(gateway);
  const id = newId();
  // Cashfree needs the payer's mobile number; for a company plan the company's contact number will do.
  let phone = mobile(o.prefill.contact);
  if (kind === 'cashfree' && !phone && o.organisationId) {
    const org = await app.db.selectFrom('organisations').select('contact_phone').where('id', '=', o.organisationId).executeTakeFirst();
    phone = mobile(org?.contact_phone);
  }
  if (kind === 'cashfree' && !phone) throw invalid('Add your mobile number to your profile to pay online.');
  let order;
  try {
    order = await gateway.createOrder({
      amountPaise: o.amountPaise,
      receipt: id,
      notes: { purpose: o.purpose, ref: id },
      customer: { id: o.payerId, name: o.prefill.name, email: o.prefill.email, phone: phone ?? undefined },
      returnUrl: `${app.config.APP_ORIGIN}/pay/return/${id}`,
    });
  } catch (e) {
    app.log.error({ gateway: (e as { gateway?: string }).gateway, provider: kind }, 'Payment order could not be created');
    throw gatewayUnavailable();
  }
  await app.db.transaction().execute(async (trx) => {
    await trx
      .insertInto('payment_orders')
      .values({
        id,
        purpose: o.purpose,
        provider: kind,
        provider_order_id: order.id,
        amount_paise: o.amountPaise,
        payer_id: o.payerId,
        organisation_id: o.organisationId ?? null,
        plan: o.plan ?? null,
        billing_cycle: o.cycle ?? null,
        gst_paise: o.gstPaise ?? 0,
        batch_id: o.batchId ?? null,
        course_id: o.courseId ?? null,
        needs_stay: o.needsStay ?? false,
        provider_payment_id: null,
        result_id: null,
        failure: null,
        paid_at: null,
      })
      .execute();
    await audit(trx, o.ctx, { action: 'payment.order_created', entityType: 'payment_order', entityId: id, after: { purpose: o.purpose, amount_paise: o.amountPaise, provider: kind, provider_order_id: order.id } });
  });
  if (kind === 'cashfree') {
    if (!order.sessionId) throw gatewayUnavailable();
    return { orderId: id, provider: 'cashfree', cashfree: { paymentSessionId: order.sessionId, mode: gateway.mode ?? 'production' } };
  }
  return {
    orderId: id,
    provider: 'razorpay',
    razorpay: { keyId: gateway.keyId, orderId: order.id, amount: o.amountPaise, currency: 'INR', name: 'AutoTalent Grid', description: o.description, prefill: o.prefill },
  };
}
