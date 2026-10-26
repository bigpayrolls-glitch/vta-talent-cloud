import { z } from 'zod';

// ---------------------------------------------------------------------------
// Phase 12: employer subscription plans (brand design of 26 Oct 2026).
// Prices are AutoTalent Grid's own figures from that design. The Growth yearly price is not in the design;
// it is 20% off twelve months and needs AutoTalent Grid's confirmation. Amounts are in paise.
// A plan's numbers are enforced on the server; the screens read the same table.
// ---------------------------------------------------------------------------

export const PLANS = ['free', 'starter', 'growth', 'enterprise'] as const;
export type Plan = (typeof PLANS)[number];
export const PAID_PLANS = ['starter', 'growth'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export const PAYMENT_METHODS = ['card', 'upi', 'netbanking'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PlanInfo {
  name: string;
  tagline: string;
  /** Monthly and yearly price in paise; null for Enterprise (agreed with AutoTalent Grid). */
  price: Record<BillingCycle, number> | null;
  /** Jobs that are waiting for review, live or paused at the same time. null = no limit. */
  activeJobs: number | null;
  /** Applicants an employer can open: per job (Free) or per calendar month across all jobs. null = no limit. */
  applicants: { limit: number; per: 'job' | 'month' } | null;
  /** Phone and email of applicants, and their shared documents. */
  contactDetails: boolean;
  /** Scheduling and recording interviews. */
  interviews: boolean;
  features: string[];
}

export const PLAN_INFO: Record<Plan, PlanInfo> = {
  free: {
    name: 'Free',
    tagline: 'Try the basics',
    price: { monthly: 0, yearly: 0 },
    activeJobs: 1,
    applicants: { limit: 3, per: 'job' },
    contactDetails: false,
    interviews: false,
    features: ['1 active job', 'Up to 3 applicants per job', 'Candidate search', 'Certificate checks by QR code'],
  },
  starter: {
    name: 'Starter',
    tagline: 'For independent workshops and small dealerships',
    price: { monthly: 99_900, yearly: 999_900 },
    activeJobs: 3,
    applicants: { limit: 25, per: 'month' },
    contactDetails: true,
    interviews: true,
    features: ['Up to 3 active jobs', 'Up to 25 applicants per month', 'View candidate contact details', 'Interview management', 'Certificate checks by QR code', 'Hiring dashboard'],
  },
  growth: {
    name: 'Growth',
    tagline: 'For dealer groups',
    price: { monthly: 299_900, yearly: 2_879_000 },
    activeJobs: 10,
    applicants: { limit: 100, per: 'month' },
    contactDetails: true,
    interviews: true,
    features: ['Up to 10 active jobs', 'Up to 100 applicants per month', 'Everything in Starter'],
  },
  enterprise: {
    name: 'Enterprise',
    tagline: 'For large networks',
    price: null,
    activeJobs: null,
    applicants: null,
    contactDetails: true,
    interviews: true,
    features: ['Jobs and applicants as agreed', 'Everything in Growth', 'Set up with AutoTalent Grid'],
  },
};

/** "₹2,999" from paise, Indian digit grouping. */
export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Percentage saved by paying yearly instead of twelve months, rounded down. */
export function yearlySaving(plan: PaidPlan): number {
  const p = PLAN_INFO[plan].price!;
  return Math.floor((1 - p.yearly / (p.monthly * 12)) * 100);
}

export const checkoutSchema = z.object({
  plan: z.enum(PAID_PLANS, { error: 'Choose a plan' }),
  cycle: z.enum(BILLING_CYCLES, { error: 'Choose monthly or yearly' }),
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how to pay' }),
  acceptTerms: z.literal(true, { error: 'Accept the terms to continue' }),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const planRequestSchema = z.object({
  plan: z.enum(['starter', 'growth', 'enterprise']),
  cycle: z.enum(BILLING_CYCLES).optional(),
  note: z.string().trim().max(500).optional(),
});

/** AutoTalent Grid sets a plan by hand (Enterprise, or a payment taken outside the platform). */
export const adminSetPlanSchema = z.object({
  plan: z.enum(PLANS),
  months: z.coerce.number().int().min(1, 'At least 1 month').max(36, 'At most 36 months').optional(),
  reason: z.string().trim().min(3, 'Say why').max(500),
});

export interface SubscriptionDto {
  plan: Plan;
  /** The plan bought, even if it has ended (then `plan` is free). */
  lastPaidPlan: Plan | null;
  cycle: BillingCycle | null;
  status: 'active' | 'expired' | 'free';
  periodEnd: string | null;
  source: 'payment' | 'admin' | null;
  usage: {
    activeJobs: number;
    activeJobsLimit: number | null;
    /** Applicants this calendar month (per-month plans), or the most on any one job (Free). */
    applicants: number;
    applicantsLimit: number | null;
    applicantsPer: 'job' | 'month' | null;
    teamMembers: number;
    /** Next reset of the monthly applicant count (1st of next month, IST). */
    resetsOn: string;
  };
  /** How payments are taken: 'test' (staging: no money moves) or 'none' (ask AutoTalent Grid). */
  paymentMode: 'test' | 'none';
}
