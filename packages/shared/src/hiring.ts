import { z } from 'zod';
import { emailSchema, nameSchema, phoneSchema } from './schemas.js';
import { SKILL_AREAS } from './training.js';

// ---------------------------------------------------------------------------
// Phase 6: Employer portal and hiring (EM-01 to EM-10, EE-07 to EE-09, AD-09)
// ---------------------------------------------------------------------------

export const SECTORS = ['dealership', 'service_workshop', 'fleet', 'oem', 'ev_service', 'roadside_assistance', 'other'] as const;
export const SECTOR_LABEL: Record<(typeof SECTORS)[number], string> = {
  dealership: 'Dealership',
  service_workshop: 'Service workshop',
  fleet: 'Fleet operator',
  oem: 'Manufacturer (OEM)',
  ev_service: 'EV service',
  roadside_assistance: 'Roadside assistance',
  other: 'Other',
};

const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

/** EM-01 / EM-02: what an employer admin keeps up to date about the company. Legal name is fixed after VTA verifies it. */
export const companyProfileSchema = z.object({
  legalName: z.string().trim().min(2, 'Enter the registered name').max(160),
  sector: z.enum(SECTORS, 'Choose a sector'),
  city: z.string().trim().min(2, 'Enter a city').max(80),
  address: optText(300),
  website: optText(200),
  description: optText(1000),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  contactName: nameSchema,
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
});

export const inviteRecruiterSchema = z.object({ name: nameSchema, email: emailSchema });

// ---- jobs ----

export const JOB_STATUSES = ['draft', 'pending_review', 'published', 'paused', 'closed', 'rejected'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  draft: 'Draft',
  pending_review: 'Waiting for AutoTalent Grid review',
  published: 'Published',
  paused: 'Paused',
  closed: 'Closed',
  rejected: 'Not approved',
};

/** EM-03: a vacancy. Salary is optional, monthly, in rupees. */
export const jobSchema = z
  .object({
    title: z.string().trim().min(3, 'Enter a job title').max(120),
    skillArea: z.enum(SKILL_AREAS, 'Choose a skill area'),
    skills: z.array(z.string().trim().min(2).max(60)).max(15).default([]),
    minExperienceMonths: z.coerce.number().int().min(0, 'Not below 0').max(480, 'Check the months'),
    city: z.string().trim().min(2, 'Enter a city').max(80),
    location: optText(160),
    salaryMin: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
    salaryMax: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
    openings: z.coerce.number().int().min(1, 'At least 1').max(500),
    shift: optText(200),
    description: z.string().trim().min(20, 'Describe the job in a few lines').max(4000),
    closingDate: z.iso.date('Choose a closing date'),
    vtaCertificatePreferred: z.boolean().default(false),
  })
  .refine((v) => v.salaryMin == null || v.salaryMax == null || v.salaryMax >= v.salaryMin, { message: 'The maximum must be at least the minimum', path: ['salaryMax'] });

export const jobFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  skillArea: z.enum(SKILL_AREAS).optional(),
  city: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

// ---- applications ----

export const APPLICATION_STATUSES = ['applied', 'shortlisted', 'interview', 'offer', 'joined', 'not_joined', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  offer: 'Offer made',
  joined: 'Joined',
  not_joined: 'Did not join',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
};
/** Still in progress: a person can have only one of these per job (EE-08). */
export const ACTIVE_APPLICATION_STATUSES = ['applied', 'shortlisted', 'interview', 'offer'] as const satisfies readonly ApplicationStatus[];

/**
 * EM-06: the moves an employer can make. Joined / did not join (EM-08) come only after an offer;
 * "not selected" is possible until then. Withdrawing is the candidate's own action.
 */
export const EMPLOYER_MOVES: Record<ApplicationStatus, ApplicationStatus[]> = {
  applied: ['shortlisted', 'rejected'],
  shortlisted: ['interview', 'offer', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['joined', 'not_joined', 'rejected'],
  joined: [],
  not_joined: [],
  rejected: [],
  withdrawn: [],
};

/** EE-08: applying confirms profile sharing with this employer, for this job. */
export const applySchema = z.object({
  shareProfile: z.literal(true, 'Confirm that your profile may be shared with this employer'),
  note: optText(500),
});

export const moveApplicationSchema = z
  .object({
    to: z.enum(APPLICATION_STATUSES),
    joiningDate: z.iso.date().optional(),
    /** With an offer: the date the person is expected to start (may be in the future). */
    expectedJoiningDate: z.iso.date().optional(),
    reason: optText(500),
  })
  .refine((v) => v.to !== 'joined' || !!v.joiningDate, { message: 'Enter the joining date', path: ['joiningDate'] })
  .refine((v) => v.to !== 'offer' || !!v.expectedJoiningDate, { message: 'Enter the expected joining date', path: ['expectedJoiningDate'] });

export const INTERVIEW_MODES = ['in_person', 'phone', 'video'] as const;
export const INTERVIEW_MODE_LABEL: Record<(typeof INTERVIEW_MODES)[number], string> = { in_person: 'In person', phone: 'Phone', video: 'Video call' };
export const INTERVIEW_OUTCOMES = ['scheduled', 'passed', 'failed', 'no_show', 'cancelled'] as const;
export const INTERVIEW_OUTCOME_LABEL: Record<(typeof INTERVIEW_OUTCOMES)[number], string> = {
  scheduled: 'Scheduled',
  passed: 'Went well',
  failed: 'Not suitable',
  no_show: 'Did not attend',
  cancelled: 'Cancelled',
};

/** EM-07: interview details. Internal notes are seen only by the employer's own team. */
export const interviewSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true, local: true }),
  mode: z.enum(INTERVIEW_MODES),
  location: optText(200),
  outcome: z.enum(INTERVIEW_OUTCOMES).default('scheduled'),
  internalNotes: optText(2000),
});

/** EM-08: VTA's follow-up on a recorded joining. An offer alone is never a joining. */
export const OUTCOME_VERIFICATION = ['unverified', 'verified', 'flagged'] as const;
export const outcomeReviewSchema = z.object({ decision: z.enum(['verified', 'flagged']), note: optText(500) });

/** AD-09: VTA's decisions on a job post. A reason is needed for anything but publishing. */
export const moderationSchema = z
  .object({ action: z.enum(['publish', 'reject', 'pause', 'close']), reason: optText(500) })
  .refine((v) => v.action === 'publish' || !!v.reason, { message: 'Give a reason', path: ['reason'] });

/** EM-04: employer search filters. Only candidates who chose to be searchable are ever returned. */
export const candidateSearchSchema = z.object({
  skillArea: z.enum(SKILL_AREAS).optional(),
  city: z.string().trim().max(80).optional(),
  minExperienceMonths: z.coerce.number().int().min(0).max(480).optional(),
  hasCertificate: z.enum(['yes']).optional(),
  courseId: z.string().uuid().optional(),
  availability: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const inviteToApplySchema = z.object({ jobId: z.string().uuid(), message: optText(300) });

/** Shown instead of a surname to employers who have not received an application (EM-05). */
export function maskedName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}
