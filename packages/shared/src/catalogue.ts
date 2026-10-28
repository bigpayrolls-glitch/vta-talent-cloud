import { z } from 'zod';
import { uuidSchema } from './schemas.js';
import { DELIVERY_MODES, SKILL_AREAS } from './training.js';

// ---------------------------------------------------------------------------
// Phase 13: public course catalogue and learner self-enrolment (brand design of 26 Oct 2026).
// Fees are set per course (by AutoTalent Grid, or by the training partner that wrote it); feeRupees includes
// GST when the course charges it (gstPct). Payment follows PAYMENT_MODE
// (a marked test payment on staging). Seats are confirmed at once while the batch has room.
// ---------------------------------------------------------------------------

export const DURATION_BUCKETS = ['lt1w', '1to4w', '1to3m', 'gt3m'] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];
export const DURATION_BUCKET_LABEL: Record<DurationBucket, string> = { lt1w: 'Under 1 week', '1to4w': '1–4 weeks', '1to3m': '1–3 months', gt3m: 'Over 3 months' };

export const FEE_BUCKETS = ['free', 'upto5k', '5kto20k', 'over20k'] as const;
export type FeeBucket = (typeof FEE_BUCKETS)[number];
export const FEE_BUCKET_LABEL: Record<FeeBucket, string> = { free: 'Free', upto5k: 'Up to ₹5,000', '5kto20k': '₹5,000 – ₹20,000', over20k: 'Over ₹20,000' };

export const COURSE_SORTS = ['soonest', 'fee_asc', 'fee_desc'] as const;
export const COURSE_SORT_LABEL: Record<(typeof COURSE_SORTS)[number], string> = { soonest: 'Starting soonest', fee_asc: 'Fee: low to high', fee_desc: 'Fee: high to low' };

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));

export const catalogueQuerySchema = z.object({
  city: z.string().trim().max(80).optional(),
  skill: csv(SKILL_AREAS),
  mode: csv(DELIVERY_MODES),
  duration: csv(DURATION_BUCKETS),
  fee: csv(FEE_BUCKETS),
  sort: z.enum(COURSE_SORTS).default('soonest'),
  q: z.string().trim().max(80).optional(),
});

export const PAY_METHODS = ['upi', 'card', 'netbanking'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { upi: 'UPI', card: 'Debit or credit card', netbanking: 'Net banking' };

export const selfEnrolSchema = z.object({
  batchId: uuidSchema,
  /** Needed only when the course has a fee. */
  method: z.enum(PAY_METHODS).optional(),
  acceptTerms: z.literal(true, 'Accept the terms to continue'),
});

export interface CatalogueBatch {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  centre: string;
  provider: string;
  city: string | null;
  address: string | null;
  capacity: number;
  seatsLeft: number;
}

export interface CatalogueCourse {
  id: string;
  title: string;
  code: string | null;
  skillArea: string;
  level: string;
  deliveryMode: string;
  durationValue: number;
  durationUnit: string;
  trainingHours: number | null;
  /** What the learner pays, including GST. */
  feeRupees: number;
  gstPct: number;
  courseType: string | null;
  imageUrl: string | null;
  /** Skill chips on the course card. */
  skillTags: string[];
  providers: string[];
  cities: string[];
  nextStart: string;
  batchCount: number;
  /** Seats left across the open batches, and the soonest batch that still has a seat (for "Enrol now"). */
  seatsLeft: number;
  nextBatchId: string | null;
}

export interface CatalogueCourseDetail extends CatalogueCourse {
  description: string | null;
  prerequisites: string | null;
  attendanceThresholdPct: number;
  passMarkPct: number;
  /** The skills the trainer assesses: "What you will learn" and the syllabus. */
  skills: { label: string; required: boolean }[];
  modules: { name: string; hours: number }[];
  learningOutcomes: string[];
  certificateType: string | null;
  batches: CatalogueBatch[];
}
