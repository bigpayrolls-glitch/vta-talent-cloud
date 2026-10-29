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
  /** Monthly and yearly price in paise; null for Enterprise (agreed with AutoTalent Grid, from `fromPrice`). */
  fromPrice?: number;
  price: Record<BillingCycle, number> | null;
  /** Jobs that are waiting for review, live or paused at the same time. null = no limit. */
  activeJobs: number | null;
  /** Applicants an employer can open: per job (Free) or per calendar month across all jobs. null = no limit. */
  applicants: { limit: number; per: 'job' | 'month' } | null;
  /** Phone and email of applicants, and their shared documents. */
  contactDetails: boolean;
  /** Scheduling and recording interviews. */
  interviews: boolean;
  /**
   * Candidate search (29 Oct 2026). `results`: how many search results are shown (null = all).
   * `profileViews` / `invites`: full profiles opened and "invite to apply" sent per calendar month (India time);
   * opening the same candidate again in the same month does not count twice. null = no limit.
   * `allFilters`: experience and certificate filters (skill area and city are always available).
   */
  search: { results: number | null; profileViews: number | null; invites: number | null; allFilters: boolean };
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
    search: { results: 20, profileViews: 5, invites: 2, allFilters: false },
    features: ['1 active job', 'Up to 3 applicants per job', 'Candidate search: first 20 results, 5 profile views a month', 'Certificate checks by QR code'],
  },
  starter: {
    name: 'Starter',
    tagline: 'For independent workshops and small dealerships',
    price: { monthly: 99_900, yearly: 999_900 },
    activeJobs: 3,
    applicants: { limit: 25, per: 'month' },
    contactDetails: true,
    interviews: true,
    search: { results: null, profileViews: 50, invites: 20, allFilters: true },
    features: ['Up to 3 active jobs', 'Up to 25 applicants per month', 'Candidate search: 50 profile views and 20 invites a month', 'View candidate contact details', 'Interview management', 'Certificate checks by QR code', 'Hiring dashboard'],
  },
  growth: {
    name: 'Growth',
    tagline: 'For dealer groups',
    price: { monthly: 299_900, yearly: 2_879_000 },
    activeJobs: 10,
    applicants: { limit: 100, per: 'month' },
    contactDetails: true,
    interviews: true,
    search: { results: null, profileViews: 300, invites: 100, allFilters: true },
    features: ['Up to 10 active jobs', 'Up to 100 applicants per month', 'Candidate search: 300 profile views and 100 invites a month', 'Everything in Starter'],
  },
  enterprise: {
    name: 'Enterprise',
    tagline: 'For large networks',
    price: null,
    fromPrice: 999_900,
    activeJobs: null,
    applicants: null,
    contactDetails: true,
    interviews: true,
    search: { results: null, profileViews: null, invites: null, allFilters: true },
    features: ['Jobs, applicants and candidate search as agreed', 'Everything in Growth', 'Set up with AutoTalent Grid'],
  },
};

/** "₹2,999" from paise, Indian digit grouping. */
export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Percentage saved by paying yearly instead of twelve months, rounded down. */
export function yearlySaving(price: Record<BillingCycle, number> | null): number {
  if (!price || !price.monthly) return 0;
  return Math.max(0, Math.floor((1 - price.yearly / (price.monthly * 12)) * 100));
}

/** All employer plans as AutoTalent Grid has set them (Admin > Plans); PLAN_INFO is the starting point. */
export type PlanTable = Record<Plan, PlanInfo>;

/** Whole rupees (the server stores paise). Not transformed here: the screen checks with the same schema. */
const rupees = z.coerce.number().int('Whole rupees only').min(0, 'Cannot be negative').max(10_000_000, 'Check the amount');
const optLimit = z.coerce.number().int('Whole numbers only').min(0, 'Cannot be negative').max(1_000_000).nullable();

/**
 * Admin > Plans: everything about one employer plan. Prices are in whole rupees here (stored in paise); a limit left
 * empty (null) means no limit. Free must cost nothing.
 */
export const employerPlanEditSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(40),
  tagline: z.string().trim().max(120),
  price: z.object({ monthly: rupees, yearly: rupees }).nullable(),
  fromPrice: rupees.optional(),
  activeJobs: optLimit,
  applicants: z.object({ limit: z.coerce.number().int().min(0).max(1_000_000), per: z.enum(['job', 'month']) }).nullable(),
  contactDetails: z.boolean(),
  interviews: z.boolean(),
  search: z.object({ results: optLimit, profileViews: optLimit, invites: optLimit, allFilters: z.boolean() }),
  features: z.array(z.string().trim().min(2).max(120)).max(12),
});

export const checkoutSchema = z.object({
  plan: z.enum(PAID_PLANS, { error: 'Choose a plan' }),
  cycle: z.enum(BILLING_CYCLES, { error: 'Choose monthly or yearly' }),
  /** Chosen on our page for test payments only; with Razorpay the payer chooses in Razorpay's own window. */
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how to pay' }).optional(),
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
  /** An employer plan for employers, a training partner plan for partners (checked on the server). */
  plan: z.enum([...PLANS, 'professional', 'institution'] as const),
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
  paymentMode: 'test' | 'none' | 'razorpay';
}

/** What an employer has used of its plan's candidate search this month. */
export interface SearchUsageDto {
  plan: Plan;
  /** First day of next month (India time), when the counts start again. */
  resetsOn: string;
  results: number | null;
  allFilters: boolean;
  profileViews: { used: number; limit: number | null };
  invites: { used: number; limit: number | null };
}

// ---------------------------------------------------------------------------
// Training partner plans (29 Oct 2026, AutoTalent Grid's Subscription & Billing design). Prices are in paise
// before GST; GST at gstPct is added at checkout. The numbers are enforced on the server: active courses
// (submitted, needing changes or published), active batches (planned or running) and current learners
// (enrolled in those batches). The other rows are what the plan includes, shown on the plans page.
// AutoTalent Grid can change all of it in Admin > Plans.
// ---------------------------------------------------------------------------

export const PARTNER_PLANS = ['free', 'professional', 'institution'] as const;
export type PartnerPlan = (typeof PARTNER_PLANS)[number];
export const PAID_PARTNER_PLANS = ['professional', 'institution'] as const;
export type PaidPartnerPlan = (typeof PAID_PARTNER_PLANS)[number];

export interface PartnerPlanInfo {
  name: string;
  tagline: string;
  price: Record<BillingCycle, number>;
  gstPct: number;
  recommended: boolean;
  activeCourses: number | null;
  activeBatches: number | null;
  learners: number | null;
  trainerManagement: boolean;
  assessments: string;
  certificates: boolean;
  reports: string;
  apiAccess: boolean;
  support: string;
  features: string[];
}
export type PartnerPlanTable = Record<PartnerPlan, PartnerPlanInfo>;

export const PARTNER_PLAN_INFO: PartnerPlanTable = {
  free: {
    name: 'Free',
    tagline: 'For new training partners',
    price: { monthly: 0, yearly: 0 },
    gstPct: 18,
    recommended: false,
    activeCourses: 2,
    activeBatches: 1,
    learners: 50,
    trainerManagement: true,
    assessments: 'Basic',
    certificates: true,
    reports: 'Basic',
    apiAccess: false,
    support: 'Email',
    features: ['2 active courses', '1 active batch', 'Up to 50 learners', 'Basic trainer management', 'Reports (basic)', 'Email support'],
  },
  professional: {
    name: 'Professional',
    tagline: 'For growing training centres',
    price: { monthly: 149_900, yearly: 1_499_900 },
    gstPct: 18,
    recommended: true,
    activeCourses: 10,
    activeBatches: 10,
    learners: 500,
    trainerManagement: true,
    assessments: 'Advanced',
    certificates: true,
    reports: 'Advanced',
    apiAccess: false,
    support: 'Priority',
    features: ['10 active courses', 'Up to 10 batches', 'Up to 500 learners', 'Trainer management', 'Assessments', 'Certificates', 'Reports (advanced)', 'Priority support'],
  },
  institution: {
    name: 'Institution',
    tagline: 'For institutes with many centres',
    price: { monthly: 399_900, yearly: 3_999_900 },
    gstPct: 18,
    recommended: false,
    activeCourses: null,
    activeBatches: null,
    learners: 2000,
    trainerManagement: true,
    assessments: 'Advanced',
    certificates: true,
    reports: 'Advanced',
    apiAccess: true,
    support: 'Dedicated manager',
    features: ['Unlimited courses', 'Unlimited batches', 'Up to 2,000 learners', 'Advanced reports', 'API access (if required)', 'Dedicated success manager'],
  },
};

/** Price, GST (rounded to whole rupees) and total in paise for a partner plan and billing period. */
export function partnerPlanTotal(info: PartnerPlanInfo, cycle: BillingCycle): { base: number; gst: number; total: number } {
  const base = info.price[cycle];
  const gst = Math.round((base * info.gstPct) / 100 / 100) * 100;
  return { base, gst, total: base + gst };
}

/** Admin > Plans: everything about one training partner plan. Prices in whole rupees before GST. */
export const partnerPlanEditSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(40),
  tagline: z.string().trim().max(120),
  price: z.object({ monthly: rupees, yearly: rupees }),
  gstPct: z.coerce.number().int().min(0).max(28, 'At most 28%'),
  recommended: z.boolean(),
  activeCourses: optLimit,
  activeBatches: optLimit,
  learners: optLimit,
  trainerManagement: z.boolean(),
  assessments: z.string().trim().max(40),
  certificates: z.boolean(),
  reports: z.string().trim().max(40),
  apiAccess: z.boolean(),
  support: z.string().trim().max(60),
  features: z.array(z.string().trim().min(2).max(120)).max(12),
});

export const partnerCheckoutSchema = z.object({
  plan: z.enum(PAID_PARTNER_PLANS, { error: 'Choose a plan' }),
  cycle: z.enum(BILLING_CYCLES, { error: 'Choose monthly or yearly' }),
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how to pay' }).optional(),
  acceptTerms: z.literal(true, { error: 'Accept the terms to continue' }),
});

export interface PartnerSubscriptionDto {
  plan: PartnerPlan;
  lastPaidPlan: PartnerPlan | null;
  cycle: BillingCycle | null;
  status: 'active' | 'expired' | 'free';
  periodEnd: string | null;
  source: 'payment' | 'admin' | null;
  usage: {
    activeCourses: number;
    activeCoursesLimit: number | null;
    activeBatches: number;
    activeBatchesLimit: number | null;
    learners: number;
    learnersLimit: number | null;
  };
  paymentMode: 'test' | 'none' | 'razorpay';
}
