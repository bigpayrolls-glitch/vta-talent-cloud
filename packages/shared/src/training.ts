import { z } from 'zod';
import { nameSchema, phoneSchema, emailSchema, uuidSchema } from './schemas.js';

/** Phase 2 vocabulary and request schemas: courses, trainers, candidates, batches, documents. */

export const SKILL_AREAS = ['2W', '4W', 'EV', 'CV', 'other'] as const;
export type SkillArea = (typeof SKILL_AREAS)[number];
export const SKILL_AREA_LABEL: Record<SkillArea, string> = {
  '2W': 'Two-wheeler',
  '4W': 'Four-wheeler',
  EV: 'Electric vehicle',
  CV: 'Commercial vehicle',
  other: 'Other',
};

export const COURSE_LEVELS = ['beginner', 'intermediate', 'advanced', 'beginner_to_advanced'] as const;
export const COURSE_LEVEL_LABEL: Record<(typeof COURSE_LEVELS)[number], string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  beginner_to_advanced: 'Beginner to advanced',
};

export const DELIVERY_MODES = ['classroom', 'online', 'blended'] as const;
export const DURATION_UNITS = ['days', 'weeks', 'months'] as const;

export const criterionSchema = z.object({
  label: z.string().trim().min(2, 'Name the criterion').max(160),
  maxScore: z.coerce.number().int().min(1, 'At least 1').max(1000),
  required: z.boolean().default(false),
});

export const courseSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'Use 2–24 letters, numbers or hyphens')
    .optional(),
  title: z.string().trim().min(3, 'Enter a course title').max(160),
  skillArea: z.enum(SKILL_AREAS),
  level: z.enum(COURSE_LEVELS),
  deliveryMode: z.enum(DELIVERY_MODES),
  durationValue: z.coerce.number().int().min(1, 'At least 1').max(365),
  durationUnit: z.enum(DURATION_UNITS),
  trainingHours: z.coerce.number().int().min(1).max(5000).optional(),
  prerequisites: z.string().trim().max(1000).optional(),
  description: z.string().trim().max(2000).optional(),
  attendanceThresholdPct: z.coerce.number().int().min(0, '0–100').max(100, '0–100'),
  passMarkPct: z.coerce.number().int().min(0, '0–100').max(100, '0–100'),
});

export const criteriaListSchema = z.object({
  criteria: z.array(criterionSchema).min(1, 'Add at least one assessment criterion').max(40),
});

/** Candidates must be adults for the pilot (decision D4). */
export const MIN_AGE = 18;

export function ageOn(dateOfBirth: string, today = new Date()): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  // Compare in IST so a birthday counts from midnight India time.
  const ist = new Date(today.getTime() + 5.5 * 3600_000);
  let age = ist.getUTCFullYear() - y;
  const beforeBirthday = ist.getUTCMonth() + 1 < m || (ist.getUTCMonth() + 1 === m && ist.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export const dateOfBirthSchema = z.iso
  .date('Use the format YYYY-MM-DD')
  .refine((v) => ageOn(v) >= MIN_AGE, `Must be ${MIN_AGE} or older during the pilot`)
  .refine((v) => ageOn(v) <= 80, 'Check the date of birth');

export const candidateSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional(),
  dateOfBirth: dateOfBirthSchema,
  city: z.string().trim().min(2, 'Enter a city').max(80),
  state: z.string().trim().max(80).optional(),
  skillAreas: z.array(z.enum(SKILL_AREAS)).max(5).default([]),
  experienceMonths: z.coerce.number().int().min(0).max(600).default(0),
  education: z.string().trim().max(160).optional(),
  languages: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
});

export const candidateUpdateSchema = candidateSchema.omit({ phone: true }).partial();

export const CANDIDATE_STATUSES = ['pending', 'verified', 'rejected', 'needs_correction'] as const;

export const trainerCreateSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional(),
  centreId: uuidSchema,
  specialisations: z.array(z.enum(SKILL_AREAS)).max(5).default([]),
});

export const BATCH_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const;

export const batchSchema = z
  .object({
    name: z.string().trim().min(3, 'Enter a batch name').max(120),
    courseId: uuidSchema,
    centreId: uuidSchema,
    trainerId: uuidSchema,
    startDate: z.iso.date('Choose a start date'),
    endDate: z.iso.date('Choose an end date'),
    capacity: z.coerce.number().int().min(1, 'At least 1').max(500, 'At most 500'),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });

export const batchUpdateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  trainerId: uuidSchema.optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  capacity: z.coerce.number().int().min(1).max(500).optional(),
});

export const enrolSchema = z.object({ candidateIds: z.array(uuidSchema).min(1, 'Choose at least one candidate').max(100) });

export const DOCUMENT_KINDS = ['certificate', 'experience_letter', 'photo', 'other'] as const;
export const DOCUMENT_KIND_LABEL: Record<(typeof DOCUMENT_KINDS)[number], string> = {
  certificate: 'Certificate',
  experience_letter: 'Experience letter',
  photo: 'Photo',
  other: 'Other document',
};

/** File rules (T-06; VTA to confirm). */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TYPES = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' } as const;

// ---------------------------------------------------------------------------
// Phase 3: attendance, assessments, credentials
// ---------------------------------------------------------------------------

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' };

export const attendanceSchema = z.object({
  date: z.iso.date('Choose a date'),
  marks: z
    .array(z.object({ candidateId: uuidSchema, status: z.enum(ATTENDANCE_STATUSES), clientOpId: uuidSchema.optional() }))
    .min(1, 'Mark at least one candidate')
    .max(500),
});

/**
 * Attendance percentage (R-06, completion rule): present or late sessions divided by sessions held,
 * leaving out sessions where the candidate was excused. Null when nothing countable has been held yet.
 */
export function attendancePct(counts: { present: number; late: number; absent: number; excused: number }): number | null {
  const countable = counts.present + counts.late + counts.absent;
  if (countable === 0) return null;
  return Math.round(((counts.present + counts.late) / countable) * 1000) / 10;
}

export const CRITERION_OUTCOMES = ['pass', 'fail', 'not_assessed'] as const;
export const RESULT_STATUSES = ['draft', 'submitted', 'returned', 'approved', 'rejected'] as const;

export const assessmentSchema = z.object({
  scores: z
    .array(
      z.object({
        criterionId: uuidSchema,
        score: z.coerce.number().int().min(0, 'Not below 0').nullable().optional(),
        outcome: z.enum(CRITERION_OUTCOMES),
        comment: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(40),
  trainerComment: z.string().trim().max(1000).optional(),
});

/**
 * Overall result (course pass rule, D9): total marks at or above the pass mark AND every required
 * criterion passed. Criteria not assessed count as 0 marks.
 */
export function assessmentOutcome(
  criteria: { id: string; maxScore: number; required: boolean }[],
  scores: { criterionId: string; score?: number | null; outcome: string }[],
  passMarkPct: number,
): { total: number; max: number; pct: number; outcome: 'pass' | 'fail'; requiredFailed: string[] } {
  const byId = new Map(scores.map((s) => [s.criterionId, s]));
  const max = criteria.reduce((s, c) => s + c.maxScore, 0);
  const total = criteria.reduce((s, c) => {
    const sc = byId.get(c.id);
    return s + (sc && sc.outcome !== 'not_assessed' ? (sc.score ?? 0) : 0);
  }, 0);
  const requiredFailed = criteria.filter((c) => c.required && byId.get(c.id)?.outcome !== 'pass').map((c) => c.id);
  const pct = max ? Math.round((total / max) * 1000) / 10 : 0;
  return { total, max, pct, outcome: pct >= passMarkPct && requiredFailed.length === 0 ? 'pass' : 'fail', requiredFailed };
}

export const CREDENTIAL_TYPE_LABEL = { course_completion: 'Course completion record' } as const;
/** Fixed wording on every credential and on the public verification page (requirements §13, decision D8). */
export const CREDENTIAL_DISCLAIMER =
  'This is a AutoTalent Grid record that the holder completed this course and passed its assessment. It is not a government, NSDC or ASDC qualification.';

/** Phase 10 (AD-05): VTA's decision on one of a candidate's documents. */
export const documentReviewSchema = z
  .object({ decision: z.enum(['verified', 'rejected']), reason: z.string().trim().max(500).optional() })
  .refine((v) => v.decision !== 'rejected' || (v.reason?.length ?? 0) >= 3, { path: ['reason'], message: 'Give a reason' });
