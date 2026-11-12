import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import { gatewayUnavailable, type GatewayOrder, type GatewayPayment, type PaymentGateway } from './razorpay.js';

/**
 * Cashfree Payments (https://www.cashfree.com/docs/), API version 2023-08-01.
 * Same rule as Razorpay: the browser never decides that a payment succeeded. After Checkout the server asks
 * Cashfree for the order's payments, and a payment counts only when Cashfree says SUCCESS for the full amount in
 * INR on this order. Cashfree captures payments itself, so there is no separate capture step.
 * Our payment_orders.id is sent as Cashfree's order_id, so provider_order_id is our own id.
 */

const API_VERSION = '2023-08-01';

interface CfPayment {
  cf_payment_id: string | number;
  order_id?: string;
  payment_status?: string;
  payment_amount?: number;
  payment_currency?: string;
  payment_group?: string | null;
}

/** Cashfree's payment_group, as the methods our receipts know. */
function method(group: string | null | undefined): string | null {
  if (!group) return null;
  if (group === 'upi') return 'upi';
  if (group.includes('card')) return 'card';
  if (group === 'net_banking') return 'netbanking';
  if (group === 'wallet') return 'wallet';
  return group;
}

export const mapCashfreePayment = (p: CfPayment, orderId: string): GatewayPayment => ({
  id: String(p.cf_payment_id),
  orderId: p.order_id ?? orderId,
  status: p.payment_status === 'SUCCESS' ? 'captured' : p.payment_status === 'FAILED' || p.payment_status === 'USER_DROPPED' || p.payment_status === 'CANCELLED' ? 'failed' : 'created',
  amountPaise: Math.round(Number(p.payment_amount ?? 0) * 100),
  currency: String(p.payment_currency ?? 'INR'),
  method: method(p.payment_group),
});

export class CashfreeGateway implements PaymentGateway {
  readonly kind = 'cashfree' as const;
  readonly keyId: string;
  readonly keySecret: string;
  /** Cashfree signs webhooks with the same secret key. */
  readonly webhookSecret: string;
  readonly mode: 'production' | 'sandbox';
  private readonly base: string;

  constructor(config: Pick<Config, 'CASHFREE_APP_ID' | 'CASHFREE_SECRET_KEY' | 'CASHFREE_ENV'>, private readonly http: typeof fetch = fetch) {
    this.keyId = config.CASHFREE_APP_ID!;
    this.keySecret = config.CASHFREE_SECRET_KEY!;
    this.webhookSecret = this.keySecret;
    this.mode = config.CASHFREE_ENV;
    this.base = this.mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${this.base}${path}`, {
      method,
      headers: {
        'x-client-id': this.keyId,
        'x-client-secret': this.keySecret,
        'x-api-version': API_VERSION,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res) throw gatewayUnavailable();
    if (!res.ok) {
      // Only Cashfree's error code is logged by callers; messages can echo request data.
      let code = '';
      try {
        code = ((await res.json()) as { code?: string }).code ?? '';
      } catch {
        /* ignore */
      }
      throw Object.assign(gatewayUnavailable(), { gateway: `HTTP ${res.status} ${code}`.trim() });
    }
    return (await res.json()) as T;
  }

  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes: Record<string, string>;
    customer?: { id: string; name?: string; email?: string; phone?: string };
    returnUrl?: string;
  }): Promise<GatewayOrder> {
    const c = input.customer;
    if (!c?.phone) throw Object.assign(gatewayUnavailable(), { gateway: 'no customer phone' });
    const o = await this.call<{ order_id: string; order_amount: number; payment_session_id: string }>('POST', '/orders', {
      order_id: input.receipt,
      order_amount: input.amountPaise / 100,
      order_currency: 'INR',
      customer_details: {
        customer_id: c.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 50),
        customer_phone: c.phone,
        ...(c.name && c.name.length >= 3 ? { customer_name: c.name.slice(0, 100) } : {}),
        ...(c.email ? { customer_email: c.email.slice(0, 100) } : {}),
      },
      order_meta: input.returnUrl ? { return_url: input.returnUrl } : undefined,
      order_tags: input.notes,
    });
    return { id: o.order_id, amountPaise: Math.round(Number(o.order_amount) * 100), sessionId: o.payment_session_id };
  }

  async fetchPayment(paymentId: string, providerOrderId?: string): Promise<GatewayPayment> {
    if (!providerOrderId) throw gatewayUnavailable();
    const p = await this.call<CfPayment>('GET', `/orders/${encodeURIComponent(providerOrderId)}/payments/${encodeURIComponent(paymentId)}`);
    return mapCashfreePayment(p, providerOrderId);
  }

  /** Cashfree captures by itself: nothing to do but read the payment again. */
  async capturePayment(paymentId: string): Promise<GatewayPayment> {
    throw Object.assign(gatewayUnavailable(), { gateway: `capture not used for ${paymentId}` });
  }

  /** The order's successful payment, if there is one (Checkout returns no payment id to the browser). */
  async findPaidPayment(providerOrderId: string): Promise<GatewayPayment | null> {
    const list = await this.call<CfPayment[]>('GET', `/orders/${encodeURIComponent(providerOrderId)}/payments`);
    const paid = (Array.isArray(list) ? list : []).find((p) => p.payment_status === 'SUCCESS');
    return paid ? mapCashfreePayment(paid, providerOrderId) : null;
  }
}

const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * x-webhook-signature = base64(HMAC-SHA256(timestamp + raw body, secret key)). Cashfree's pseudocode puts a "."
 * between the two while its SDKs do not, so both forms are accepted (each still needs the secret key).
 */
export function cashfreeWebhookOk(secret: string, rawBody: Buffer, timestamp: string, signature: string): boolean {
  const body = rawBody.toString('utf8');
  return same(signature, sign(secret, `${timestamp}${body}`)) || same(signature, sign(secret, `${timestamp}.${body}`));
}

/** For tests: what Cashfree would send. */
export const signCashfreeForTests = (secret: string, timestamp: string, body: string) => sign(secret, `${timestamp}${body}`);
