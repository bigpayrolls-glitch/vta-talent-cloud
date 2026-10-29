import { api } from './api';

/**
 * Razorpay Checkout, loaded only when someone pays. The browser never decides that a payment succeeded: the ids
 * and signature Checkout returns go to POST /payments/:id/verify, which checks them with Razorpay.
 */
const SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** What the API returns when it has created an order (plan checkout or paid enrolment). */
export interface RazorpayStart {
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

export type PaymentOutcome =
  | { status: 'paid'; purpose: 'plan'; paymentId: string }
  | { status: 'paid'; purpose: 'course'; enrolmentId: string }
  | { status: 'paid'; purpose: 'booking'; bookingId: string }
  | { status: 'needs_refund'; purpose: 'plan' | 'course' | 'booking'; message: string };

interface Success {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
type Ctor = new (o: Record<string, unknown>) => { open(): void; on(ev: 'payment.failed', cb: (e: { error?: { description?: string } }) => void): void };

let loading: Promise<Ctor> | null = null;
function load(): Promise<Ctor> {
  const w = window as unknown as { Razorpay?: Ctor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  loading ??= new Promise<Ctor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Razorpay could not start')));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('Could not open the payment window. Check your internet connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export class PaymentCancelled extends Error {
  constructor() {
    super('Payment cancelled. You can try again.');
  }
}

/**
 * Opens Razorpay Checkout for an order and, once the payer finishes, asks the API to verify it.
 * Rejects with PaymentCancelled if the window is closed without paying.
 */
export async function payWithRazorpay(start: RazorpayStart, onVerifying?: () => void): Promise<PaymentOutcome> {
  const Razorpay = await load();
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
