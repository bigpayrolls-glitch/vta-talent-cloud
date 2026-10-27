import { z } from 'zod';
import { SECTORS } from './hiring.js';
import { SKILL_AREAS } from './training.js';
import { NOTICE_VERSION } from './learner.js';
import { emailSchema, nameSchema, PARTNER_SUBTYPES, phoneSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Phase 8: employers and training partners register their own organisation (EM-01, PA-01).
// The organisation stays "pending" until VTA verifies it; the person confirms their email first.
// ---------------------------------------------------------------------------

export const PARTNER_SUBTYPE_LABEL: Record<(typeof PARTNER_SUBTYPES)[number], string> = {
  oem: 'OEM',
  csr_sponsor: 'CSR sponsor',
  ngo: 'NGO',
  college: 'College',
  training_provider: 'Training provider',
  automotive_company: 'Automotive or lubricant company',
  other: 'Other',
};

const accepted = (what: string) => z.literal(true, `Accept the ${what} to continue`);

export const orgSignupSchema = z
  .object({
    type: z.enum(['employer', 'partner']),
    legalName: z.string().trim().min(2, 'Enter the registered name').max(160),
    sector: z.enum(SECTORS, 'Choose a sector').optional(),
    partnerSubtype: z.enum(PARTNER_SUBTYPES, 'Choose the partner type').optional(),
    city: z.string().trim().min(2, 'Enter a city').max(80),
    contactName: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    acceptPrivacy: accepted('privacy notice'),
    acceptTerms: accepted('terms of use'),
    noticeVersion: z.literal(NOTICE_VERSION, 'The privacy notice has changed. Reload the page and read it again.'),
    /** Left empty by people; filled in by most form-filling bots. */
    nickname: z.string().max(200).optional(),
  })
  // `when` makes these run alongside the field checks, so the form shows every problem at once.
  .refine((v) => v.type !== 'employer' || !!v.sector, { path: ['sector'], message: 'Choose a sector', when: () => true })
  .refine((v) => v.type !== 'partner' || !!v.partnerSubtype, { path: ['partnerSubtype'], message: 'Choose the partner type', when: () => true });
export type OrgSignupInput = z.input<typeof orgSignupSchema>;

// ---------------------------------------------------------------------------
// Five logins (27 Oct 2026): an individual or freelance trainer signs up with their mobile number.
// They can sign in at once; an Admin verifies them before they can be given a batch.
// ---------------------------------------------------------------------------

export const trainerSignupSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  name: nameSchema,
  city: z.string().trim().min(2, 'Enter a city').max(80),
  specialisations: z.array(z.enum(SKILL_AREAS), 'Choose at least one skill area').min(1, 'Choose at least one skill area').max(5),
  experienceYears: z.coerce.number().int('Whole years').min(0, '0 or more').max(50, 'At most 50'),
  acceptPrivacy: z.literal(true, 'Accept the privacy notice to continue'),
  acceptTerms: z.literal(true, 'Accept the terms of use to continue'),
  noticeVersion: z.literal(NOTICE_VERSION, 'The privacy notice has changed. Reload the page and read it again.'),
});
export type TrainerSignupInput = z.input<typeof trainerSignupSchema>;
