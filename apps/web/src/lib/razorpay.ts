import { api } from './api';

/**
 * Online payment Checkout: Razorpay or Cashfree, whichever the API started the order with. The script is loaded
 * only when someone pays. The browser never decides that a payment succeeded: after Checkout it asks the API
 * (POST /payments/:id/verify), which checks the payment with the provider.
 */
const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const CASHFREE_SRC = 'https://sdk.cashfree.com/js/v3/cashfree.js';

/** What the API returns when it has created a Razorpay order. */
export interface RazorpayStart {
  orderId: string;
  provider?: 'razorpay';
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

/** What the API returns when it has created a Cashfree order. */
export interface CashfreeStart {
  orderId: string;
  provider: 'cashfree';
  cashfree: { paymentSessionId: string; mode: 'production' | 'sandbox' };
}

/** An order to pay online (plan checkout, paid enrolment or career-journey booking). */
export type OnlineStart = RazorpayStart | CashfreeStart;

/** True when the API answered with an order to pay rather than a finished record. */
export const isOnlineStart = (r: object): r is OnlineStart => 'razorpay' in r || 'cashfree' in r;

export type PaymentOutcome =
  | { status: 'paid'; purpose: 'plan'; paymentId: string }
  | { status: 'paid'; purpose: 'course'; enrolmentId: string }
  | { status: 'paid'; purpose: 'booking'; bookingId: string }
  | { status: 'needs_refund'; purpose: 'plan' | 'course' | 'booking'; message: string }
  | { status: 'pending'; message: string };

interface Success {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
type RazorpayCtor = new (o: Record<string, unknown>) => { open(): void; on(ev: 'payment.failed', cb: (e: { error?: { description?: string } }) => void): void };
type CashfreeFactory = (o: { mode: 'production' | 'sandbox' }) => {
  checkout(o: { paymentSessionId: string; redirectTarget: '_modal' | '_self' }): Promise<{ error?: { message?: string }; redirect?: boolean; paymentDetails?: unknown }>;
};

const loading = new Map<string, Promise<unknown>>();
function load<T>(src: string, global: 'Razorpay' | 'Cashfree'): Promise<T> {
  const w = window as unknown as Record<string, T | undefined>;
  if (w[global]) return Promise.resolve(w[global] as T);
  if (!loading.has(src)) {
    loading.set(
      src,
      new Promise<T>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => (w[global] ? resolve(w[global] as T) : reject(new Error('The payment window could not start')));
        s.onerror = () => {
          loading.delete(src);
          s.remove();
          reject(new Error('Could not open the payment window. Check your internet connection and try again.'));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return loading.get(src) as Promise<T>;
}

export class PaymentCancelled extends Error {
  constructor() {
    super('Payment cancelled. You can try again.');
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Asks the API about a Cashfree order a few times, since the payment can take a moment to show as successful. */
export async function confirmPayment(orderId: string, tries = 4): Promise<PaymentOutcome> {
  let out = await api.post<PaymentOutcome>(`/payments/${orderId}/verify`, {});
  for (let i = 1; i < tries && out.status === 'pending'; i++) {
    await wait(2500);
    out = await api.post<PaymentOutcome>(`/payments/${orderId}/verify`, {});
  }
  return out;
}

async function payWithCashfree(start: CashfreeStart, onVerifying?: () => void): Promise<PaymentOutcome> {
  const Cashfree = await load<CashfreeFactory>(CASHFREE_SRC, 'Cashfree');
  const cf = Cashfree({ mode: start.cashfree.mode });
  const r = await cf.checkout({ paymentSessionId: start.cashfree.paymentSessionId, redirectTarget: '_modal' });
  // On some phones Checkout opens as its own page; the payer then comes back to /pay/return/:orderId.
  if (r.redirect) return new Promise<never>(() => undefined);
  onVerifying?.();
  const out = await confirmPayment(start.orderId, r.error ? 1 : 4);
  if (out.status === 'pending' && r.error) throw new PaymentCancelled();
  return out;
}

async function payWithRazorpayCheckout(start: RazorpayStart, onVerifying?: () => void): Promise<PaymentOutcome> {
  const Razorpay = await load<RazorpayCtor>(RAZORPAY_SRC, 'Razorpay');
  const r = start.razorpay;
  const success = await new Promise<Success>((resolve, reject) => {
    const rp = new Razorpay({
      key: r.keyId,
      order_id: r.orderId,
      amount: r.amount,
      currency: r.currency,
      name: r.name,
      description: r.description,
      prefill: r.prefill,
      theme: { color: '#D7141C' },
      handler: (s: Success) => resolve(s),
      modal: { ondismiss: () => reject(new PaymentCancelled()) },
    });
    rp.open();
  });
  onVerifying?.();
  return api.post<PaymentOutcome>(`/payments/${start.orderId}/verify`, { razorpayPaymentId: success.razorpay_payment_id, razorpaySignature: success.razorpay_signature });
}

/**
 * Opens the provider's Checkout for an order and, once the payer finishes, asks the API to verify it.
 * Rejects with PaymentCancelled if the window is closed without paying.
 */
export function payOnline(start: OnlineStart, onVerifying?: () => void): Promise<PaymentOutcome> {
  return 'cashfree' in start ? payWithCashfree(start, onVerifying) : payWithRazorpayCheckout(start, onVerifying);
}
