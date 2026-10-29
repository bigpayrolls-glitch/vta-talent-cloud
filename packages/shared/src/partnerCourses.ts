import { z } from 'zod';
import { uuidSchema } from './schemas.js';
import { COURSE_LEVELS, DELIVERY_MODES, DURATION_UNITS, SKILL_AREAS } from './training.js';

// ---------------------------------------------------------------------------
// Training partner courses (wireframe "Course creation and approval journey", 27 Oct 2026).
// A partner builds a course in four steps (basic details, content, fee & batch, review) and submits it.
// AutoTalent Grid reviews it; learners see it only after it is approved and published.
// ---------------------------------------------------------------------------

export const COURSE_APPROVAL_STATUSES = ['draft', 'submitted', 'changes_requested', 'rejected', 'published'] as const;
export type CourseApprovalStatus = (typeof COURSE_APPROVAL_STATUSES)[number];
export const COURSE_APPROVAL_LABEL: Record<CourseApprovalStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted for review',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
  published: 'Published',
};

/** The wireframe calls the skill area the course category. */
export const COURSE_CATEGORY_LABEL: Record<(typeof SKILL_AREAS)[number], string> = {
  '2W': '2W Service',
  '4W': '4W Service',
  EV: 'EV Service',
  CV: 'CV Service',
  other: 'Other',
};

export const COURSE_TYPES = ['certification', 'short_term', 'skill_upgrade'] as const;
export const COURSE_TYPE_LABEL: Record<(typeof COURSE_TYPES)[number], string> = {
  certification: 'Certification',
  short_term: 'Short term',
  skill_upgrade: 'Skill upgrade',
};

/** Shown to partners and learners; "blended" is stored, "Hybrid" is what people call it. */
export const DELIVERY_MODE_LABEL: Record<(typeof DELIVERY_MODES)[number], string> = { classroom: 'Classroom', online: 'Online', blended: 'Hybrid' };

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export const CERTIFICATE_TYPES = ['Partner Certificate', 'AutoTalent Grid Certificate', 'Co-branded Certificate', 'No certificate'] as const;

/** Chips offered in step 2; partners can add their own. */
export const SUGGESTED_SKILLS = [
  'Engine Service',
  'Brake Service',
  'Electrical Diagnostics',
  'FI System',
  'Periodic Maintenance',
  'Troubleshooting',
  'Battery & BMS',
  'Suspension',
  'Transmission',
  'Customer Handling',
] as const;

export const COURSE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const COURSE_DESCRIPTION_MAX = 500;

/** GST is added on top of the course fee. Whole rupees, rounded to the nearest rupee. */
export function feeWithGst(feeRupees: number, gstPct: number): { gstRupees: number; totalRupees: number } {
  const gstRupees = Math.round((feeRupees * gstPct) / 100);
  return { gstRupees, totalRupees: feeRupees + gstRupees };
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** Step 1: basic details. */
export const partnerCourseDetailsSchema = z.object({
  title: z.string().trim().min(3, 'Enter a course title').max(160),
  skillArea: z.enum(SKILL_AREAS, 'Choose a category'),
  courseType: z.enum(COURSE_TYPES, 'Choose a course type'),
  level: z.enum(COURSE_LEVELS, 'Choose a level'),
  description: z.string().trim().min(20, 'Describe the course in at least 20 characters').max(COURSE_DESCRIPTION_MAX, `At most ${COURSE_DESCRIPTION_MAX} characters`),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  deliveryMode: z.enum(DELIVERY_MODES, 'Choose a delivery mode'),
  durationValue: z.coerce.number().int().min(1, 'At least 1').max(365),
  durationUnit: z.enum(DURATION_UNITS),
});

const round2 = (h: number) => Math.round(h * 100) / 100;
const moduleHours = z.coerce.number('Enter the time in hours or minutes').min(0, 'Cannot be negative').max(500, 'At most 500 hours').transform(round2);

/**
 * Module time is kept in hours, to two decimals (30 minutes = 0.5); partners may type hours or minutes.
 * Hybrid courses split each module into theory and practical time; the module's hours are then their sum.
 */
export const courseModuleSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the module').max(120),
    hours: moduleHours.optional(),
    theoryHours: moduleHours.optional(),
    practicalHours: moduleHours.optional(),
  })
  .transform((m): CourseModuleTime => {
    const split = m.theoryHours !== undefined || m.practicalHours !== undefined;
    if (!split) return { name: m.name, hours: m.hours ?? 0 };
    const theoryHours = m.theoryHours ?? 0;
    const practicalHours = m.practicalHours ?? 0;
    return { name: m.name, hours: round2(theoryHours + practicalHours), theoryHours, practicalHours };
  })
  .refine((m) => m.hours >= 0.05, { message: 'At least 3 minutes', path: ['hours'] })
  .refine((m) => m.hours <= 500, { message: 'At most 500 hours', path: ['hours'] });

/** A module as stored: total hours, and for hybrid courses the theory and practical parts. */
export interface CourseModuleTime {
  name: string;
  hours: number;
  theoryHours?: number;
  practicalHours?: number;
}

/** "8 h theory + 4 h practical", when a module is split. */
export function splitLabel(m: Pick<CourseModuleTime, 'theoryHours' | 'practicalHours'>): string | null {
  if (m.theoryHours === undefined && m.practicalHours === undefined) return null;
  return `${hoursLabel(m.theoryHours ?? 0)} theory + ${hoursLabel(m.practicalHours ?? 0)} practical`;
}

/** Minutes typed by a partner, as hours (two decimals). */
export const minutesToHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** "6 h", or "0.5 h (30 min)" when it is not a whole number of hours. */
export function hoursLabel(hours: number): string {
  const h = Math.round(hours * 100) / 100;
  if (Number.isInteger(h)) return `${h} h`;
  return `${h} h (${Math.round(hours * 60)} min)`;
}

/** Step 2: course content. */
export const partnerCourseContentSchema = z.object({
  modules: z.array(courseModuleSchema).max(40),
  skills: z.array(z.string().trim().min(2, 'A skill needs at least 2 characters').max(200, 'Keep each skill under 200 characters')).max(30, 'At most 30 skills'),
  prerequisites: optionalText(300),
  learningOutcomes: z.array(z.string().trim().min(3, 'An outcome needs at least 3 characters').max(300, 'Keep each outcome under 300 characters')).max(20, 'At most 20 outcomes'),
});

export const firstBatchSchema = z
  .object({
    name: z.string().trim().min(3, 'Enter a batch name').max(120),
    centreId: uuidSchema,
    trainerId: uuidSchema,
    startDate: z.iso.date('Choose a start date'),
    endDate: z.iso.date('Choose an end date'),
    capacity: z.coerce.number().int().min(1, 'At least 1').max(500, 'At most 500'),
    classTimings: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });

/** Step 3: fee and first batch. */
export const partnerCourseFeeSchema = z.object({
  feeRupees: z.coerce.number().int('Whole rupees only').min(0, 'Cannot be negative').max(500_000, 'At most ₹5,00,000'),
  gstPct: z.coerce.number().int().refine((v) => (GST_RATES as readonly number[]).includes(v), 'Choose 0, 5, 12, 18 or 28%'),
  certificateType: z.enum(CERTIFICATE_TYPES, 'Choose a certificate type'),
  firstBatch: firstBatchSchema.nullable().optional(),
  stayAvailable: z.boolean().optional(),
  stayFeeRupees: z.coerce.number().int('Whole rupees only').min(0, 'Cannot be negative').max(200_000, 'At most ₹2,00,000').nullable().optional(),
});

/** A save from any step of the wizard. Each part is optional; the course is checked as a whole on submit. */
export const partnerCourseSaveSchema = partnerCourseDetailsSchema
  .partial()
  .extend(partnerCourseContentSchema.partial().shape)
  .extend(partnerCourseFeeSchema.partial().shape);

export const COURSE_REVIEW_ACTIONS = ['publish', 'request_changes', 'reject'] as const;
export const courseReviewSchema = z
  .object({
    action: z.enum(COURSE_REVIEW_ACTIONS),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.action === 'publish' || (v.note && v.note.length >= 5), { message: 'Tell the partner what to change (at least 5 characters)', path: ['note'] });

export const partnerBatchSchema = z
  .object({
    name: z.string().trim().min(3, 'Enter a batch name').max(120),
    centreId: uuidSchema,
    trainerId: uuidSchema,
    startDate: z.iso.date('Choose a start date'),
    endDate: z.iso.date('Choose an end date'),
    capacity: z.coerce.number().int().min(1, 'At least 1').max(500, 'At most 500'),
    classTimings: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });

export interface CourseHistoryEvent {
  action: 'created' | 'submitted' | 'changes_requested' | 'rejected' | 'published' | 'unpublished' | 'republished';
  note: string | null;
  actor: string | null;
  at: string;
}

export interface PartnerCourse {
  id: string;
  title: string;
  skillArea: (typeof SKILL_AREAS)[number];
  courseType: (typeof COURSE_TYPES)[number] | null;
  level: (typeof COURSE_LEVELS)[number];
  description: string | null;
  city: string | null;
  deliveryMode: (typeof DELIVERY_MODES)[number];
  durationValue: number;
  durationUnit: (typeof DURATION_UNITS)[number];
  trainingHours: number | null;
  modules: CourseModuleTime[];
  skills: string[];
  prerequisites: string | null;
  learningOutcomes: string[];
  feeRupees: number;
  gstPct: number;
  totalFeeRupees: number;
  stayAvailable: boolean;
  stayFeeRupees: number | null;
  certificateType: string | null;
  firstBatch: (z.infer<typeof firstBatchSchema> & { centreName?: string; trainerName?: string }) | null;
  imageUrl: string | null;
  approvalStatus: CourseApprovalStatus;
  active: boolean;
  reviewNote: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  owner: { id: string; name: string } | null;
  batchCount?: number;
  enrolled?: number;
}
