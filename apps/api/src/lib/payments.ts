import type { FastifyInstance } from 'fastify';
import { audit, type AuditContext } from '../audit/service.js';
import { newId } from './crypto.js';
import { gatewayUnavailable } from './razorpay.js';

/** What the browser needs to open Razorpay Checkout for one order. */
export interface RazorpayCheckout {
  orderId: string;
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

/**
 * Creates a Razorpay order and our payment_orders row. Nothing is granted here: the plan or seat is given only
 * when the payment is verified (signature from Checkout, or a signed webhook) and matches this order.
 */
export async function startRazorpayOrder(
  app: FastifyInstance,
  o: {
    purpose: 'plan' | 'course';
    amountPaise: number;
    payerId: string;
    organisationId?: string;
    plan?: 'starter' | 'growth';
    cycle?: 'monthly' | 'yearly';
    batchId?: string;
    needsStay?: boolean;
    description: string;
    prefill: { name?: string; email?: string; contact?: string };
    ctx: AuditContext;
  },
): Promise<RazorpayCheckout> {
  const gateway = app.gateway;
  if (!gateway) throw gatewayUnavailable();
  const id = newId();
  let order;
  try {
    order = await gateway.createOrder({ amountPaise: o.amountPaise, receipt: id, notes: { purpose: o.purpose, ref: id } });
  } catch (e) {
    app.log.error({ gateway: (e as { gateway?: string }).gateway }, 'Razorpay order could not be created');
    throw gatewayUnavailable();
  }
  await app.db.transaction().execute(async (trx) => {
    await trx
      .insertInto('payment_orders')
      .values({
        id,
        purpose: o.purpose,
        provider_order_id: order.id,
        amount_paise: o.amountPaise,
        payer_id: o.payerId,
        organisation_id: o.organisationId ?? null,
        plan: o.plan ?? null,
        billing_cycle: o.cycle ?? null,
        batch_id: o.batchId ?? null,
        needs_stay: o.needsStay ?? false,
        provider_payment_id: null,
        result_id: null,
        failure: null,
        paid_at: null,
      })
      .execute();
    await audit(trx, o.ctx, { action: 'payment.order_created', entityType: 'payment_order', entityId: id, after: { purpose: o.purpose, amount_paise: o.amountPaise, razorpay_order_id: order.id } });
  });
  return {
    orderId: id,
    razorpay: { keyId: gateway.keyId, orderId: order.id, amount: o.amountPaise, currency: 'INR', name: 'AutoTalent Grid', description: o.description, prefill: o.prefill },
  };
}
