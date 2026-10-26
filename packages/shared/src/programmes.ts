import { z } from 'zod';
import { emailSchema, nameSchema, PARTNER_SUBTYPES, phoneSchema, uuidSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Phase 7: partner programmes and reports (PA-01 to PA-06, AD-10, AD-11, §17)
// ---------------------------------------------------------------------------

const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

/** PA-01: what a partner admin keeps up to date about their organisation before VTA verifies it. */
export const partnerProfileSchema = z.object({
  legalName: z.string().trim().min(2, 'Enter the registered name').max(160),
  partnerSubtype: z.enum(PARTNER_SUBTYPES, 'Choose the partner type'),
  city: z.string().trim().min(2, 'Enter a city').max(80),
  address: optText(300),
  website: optText(200),
  registrationNumber: optText(60),
  programmeInterests: optText(1000),
  contactName: nameSchema,
  contactEmail: emailSchema,
  contactPhone: phoneSchema,
});

export const PROGRAMME_STATUSES = ['planned', 'active', 'closed'] as const;
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number];

/**
 * PA-04: the beneficiary fields a partner may see for a programme, approved by VTA for that programme.
 * Name, mobile number and date of birth are personal and off unless VTA records the basis for sharing them.
 */
export const BENEFICIARY_FIELDS = ['candidateCode', 'name', 'phone', 'dateOfBirth', 'city', 'batch', 'enrolmentStatus', 'attendance', 'assessment', 'certificate', 'employment'] as const;
export type BeneficiaryField = (typeof BENEFICIARY_FIELDS)[number];
export const SENSITIVE_BENEFICIARY_FIELDS: readonly BeneficiaryField[] = ['name', 'phone', 'dateOfBirth'];
export const DEFAULT_BENEFICIARY_FIELDS: BeneficiaryField[] = ['candidateCode', 'city', 'batch', 'enrolmentStatus', 'attendance', 'assessment', 'certificate', 'employment'];
export const BENEFICIARY_FIELD_LABEL: Record<BeneficiaryField, string> = {
  candidateCode: 'Candidate ID',
  name: 'Name',
  phone: 'Mobile number',
  dateOfBirth: 'Date of birth',
  city: 'City',
  batch: 'Batch',
  enrolmentStatus: 'Enrolment status',
  attendance: 'Attendance %',
  assessment: 'Assessment result',
  certificate: 'VTA certificate',
  employment: 'Employment outcome',
};

/** AD-10: a sponsor or partner programme. Budget figures are only a manually approved reference with source and date. */
export const programmeSchema = z
  .object({
    name: z.string().trim().min(3, 'Enter a programme name').max(160),
    description: optText(2000),
    sponsorOrganisationId: uuidSchema.optional().nullable(),
    partnerOrganisationIds: z.array(uuidSchema).min(1, 'Assign at least one partner').max(10),
    batchIds: z.array(uuidSchema).max(100).default([]),
    targetCount: z.coerce.number().int().min(1, 'At least 1').max(100_000),
    startDate: z.iso.date('Choose a start date'),
    endDate: z.iso.date('Choose an end date'),
    status: z.enum(PROGRAMME_STATUSES).default('planned'),
    reportingRequirements: optText(2000),
    beneficiaryFields: z.array(z.enum(BENEFICIARY_FIELDS)).default(DEFAULT_BENEFICIARY_FIELDS),
    sharingBasis: optText(500),
    budgetReference: optText(200),
    budgetAmount: z.coerce.number().int().min(0).max(10_000_000_000).optional().nullable(),
    budgetSource: optText(200),
    budgetAsOf: z.iso.date().optional().nullable().or(z.literal('').transform(() => null)),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'The end date must be on or after the start date', path: ['endDate'] })
  .refine((v) => !v.beneficiaryFields.some((f) => SENSITIVE_BENEFICIARY_FIELDS.includes(f)) || !!v.sharingBasis, {
    message: 'Record the basis for sharing names, mobile numbers or dates of birth',
    path: ['sharingBasis'],
  })
  .refine((v) => v.budgetAmount == null || (!!v.budgetSource && !!v.budgetAsOf), { message: 'Give the source and date of the budget figure', path: ['budgetSource'] });

export const PROGRAMME_DOCUMENT_CATEGORIES = ['work_order', 'attendance_summary', 'report', 'evidence', 'other'] as const;
export const PROGRAMME_DOCUMENT_LABEL: Record<(typeof PROGRAMME_DOCUMENT_CATEGORIES)[number], string> = {
  work_order: 'Work order',
  attendance_summary: 'Attendance summary',
  report: 'Report',
  evidence: 'Supporting evidence',
  other: 'Other',
};

/** AD-11: report filters. Cohort = enrolments in batches that start within the dates. */
export const reportFilterSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  courseId: uuidSchema.optional(),
  centreId: uuidSchema.optional(),
  partnerId: uuidSchema.optional(),
  programmeId: uuidSchema.optional(),
});

/**
 * One reported figure with its definition (requirements §17). `denominator` is shown with every rate,
 * and `basis` says whether the number is an actual count, a target or management-reported.
 */
export interface Metric {
  key: string;
  label: string;
  value: number;
  denominator?: { label: string; value: number };
  definition: string;
  basis: 'actual' | 'target' | 'employer_reported' | 'vta_verified';
}
