import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';
import { ApiError } from './errors.js';

/**
 * Razorpay (https://razorpay.com/docs/api/), same account and approach as PF Mitra.
 * The browser never decides that a payment succeeded: Checkout's signature is checked here, the payment is then
 * fetched from Razorpay and must match the order (amount, order id) and be captured. Amounts are paise, INR only.
 */

export interface GatewayOrder {
  id: string;
  amountPaise: number;
}

export interface GatewayPayment {
  id: string;
  orderId: string | null;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  amountPaise: number;
  currency: string;
  method: string | null;
}

export interface PaymentGateway {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string | undefined;
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  capturePayment(paymentId: string, amountPaise: number): Promise<GatewayPayment>;
}

export const gatewayUnavailable = () => new ApiError('UNAVAILABLE', 'The payment service is not reachable right now. Please try again in a minute.');

interface RzpPayment {
  id: string;
  order_id?: string | null;
  status: string;
  amount: number;
  currency?: string;
  method?: string | null;
}

const STATUSES = ['created', 'authorized', 'captured', 'refunded', 'failed'] as const;
export const mapPayment = (p: RzpPayment): GatewayPayment => ({
  id: p.id,
  orderId: p.order_id ?? null,
  status: (STATUSES as readonly string[]).includes(p.status) ? (p.status as GatewayPayment['status']) : 'created',
  amountPaise: Number(p.amount),
  currency: String(p.currency ?? 'INR'),
  method: p.method ?? null,
});

export class RazorpayGateway implements PaymentGateway {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string | undefined;
  private readonly base: string;

  constructor(
    config: Pick<Config, 'RAZORPAY_KEY_ID' | 'RAZORPAY_KEY_SECRET' | 'RAZORPAY_WEBHOOK_SECRET' | 'RAZORPAY_API_BASE'>,
    private readonly http: typeof fetch = fetch,
  ) {
    this.keyId = config.RAZORPAY_KEY_ID!;
    this.keySecret = config.RAZORPAY_KEY_SECRET!;
    this.webhookSecret = config.RAZORPAY_WEBHOOK_SECRET;
    this.base = config.RAZORPAY_API_BASE.replace(/\/+$/, '');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const res = await this.http(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res) throw gatewayUnavailable();
    if (!res.ok) {
      // Only Razorpay's error code is logged by callers; descriptions can echo request data.
      let code = '';
      try {
        code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? '';
      } catch {
        /* ignore */
      }
      throw Object.assign(gatewayUnavailable(), { gateway: `HTTP ${res.status} ${code}`.trim() });
    }
    return (await res.json()) as T;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder> {
    const o = await this.call<{ id: string; amount: number }>('POST', '/orders', { amount: input.amountPaise, currency: 'INR', receipt: input.receipt.slice(0, 40), notes: input.notes });
    return { id: o.id, amountPaise: Number(o.amount) };
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    return mapPayment(await this.call<RzpPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`));
  }

  async capturePayment(paymentId: string, amountPaise: number): Promise<GatewayPayment> {
    return mapPayment(await this.call<RzpPayment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' }));
  }
}

const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

function sameHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** Checkout's razorpay_signature = HMAC-SHA256(order_id + "|" + payment_id, key secret). */
export const checkoutSignatureOk = (keySecret: string, orderId: string, paymentId: string, signature: string) =>
  sameHex(signature, hmac(keySecret, `${orderId}|${paymentId}`));

/** X-Razorpay-Signature = HMAC-SHA256(raw request body, webhook secret). */
export const webhookSignatureOk = (webhookSecret: string, rawBody: Buffer, signature: string) => sameHex(signature, hmac(webhookSecret, rawBody));

/** For tests: what Razorpay would send. */
export const signForTests = hmac;

/** The method Razorpay reports, as stored on receipts. */
export function recordedMethod(m: string | null): 'card' | 'upi' | 'netbanking' | 'wallet' | 'other' {
  return m === 'card' || m === 'upi' || m === 'netbanking' || m === 'wallet' ? m : 'other';
}
