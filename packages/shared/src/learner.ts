import { z } from 'zod';
import { emailSchema, nameSchema, phoneSchema } from './schemas.js';
import { dateOfBirthSchema, DOCUMENT_KINDS, SKILL_AREAS } from './training.js';

// ---------------------------------------------------------------------------
// Phase 5: Learner portal (EE-01 to EE-06, EE-10, EE-12, SH-05)
// ---------------------------------------------------------------------------

/**
 * Version of the privacy notice and terms a person accepts. Change it when the wording changes:
 * everyone is asked to accept again on their next sign-in. The text is a DRAFT until VTA approves it.
 */
export const NOTICE_VERSION = '2026-10-draft';

/**
 * What a person can agree to. Every change is kept (never edited), so the history shows what was
 * agreed, when, to which version, and who recorded it.
 * - privacy_notice, terms: accepted to use the platform.
 * - profile_searchable: employers may find this profile in search (off unless the person turns it on).
 */
export const CONSENT_PURPOSES = ['privacy_notice', 'terms', 'profile_searchable'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const CONSENT_LABEL: Record<ConsentPurpose, string> = {
  privacy_notice: 'Privacy notice',
  terms: 'Terms of use',
  profile_searchable: 'Employers can find my profile',
};

const accepted = (what: string) => z.literal(true, `Accept the ${what} to continue`);

/** EE-01: self-registration. The phone is proved with a code; the rest of the profile can be finished later. */
export const registerSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  name: nameSchema,
  dateOfBirth: dateOfBirthSchema,
  city: z.string().trim().min(2, 'Enter a city').max(80),
  acceptPrivacy: accepted('privacy notice'),
  acceptTerms: accepted('terms of use'),
  noticeVersion: z.literal(NOTICE_VERSION, 'The privacy notice has changed. Reload the page and read it again.'),
});

export const PROFILE_FIELDS = ['name', 'dateOfBirth', 'email', 'city', 'state', 'preferredWorkArea', 'skillAreas', 'experienceMonths', 'education', 'languages', 'availability'] as const;

/** EE-02: what a learner may change on their own profile. Name and date of birth only while unverified. */
export const learnerProfileSchema = z
  .object({
    name: nameSchema,
    dateOfBirth: dateOfBirthSchema,
    email: emailSchema.or(z.literal('')),
    city: z.string().trim().min(2, 'Enter a city').max(80),
    state: z.string().trim().max(80),
    preferredWorkArea: z.string().trim().max(120),
    skillAreas: z.array(z.enum(SKILL_AREAS)).max(5),
    experienceMonths: z.coerce.number().int().min(0, 'Not below 0').max(600, 'Check the number of months'),
    education: z.string().trim().max(160),
    languages: z.array(z.string().trim().min(2).max(40)).max(10),
    availability: z.string().trim().max(120),
  })
  .partial();

export const consentChangeSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  noticeVersion: z.string().max(40).optional(),
});

/** EE-03: each evidence file is private, or visible to employers the person shares their profile with. */
export const DOCUMENT_VISIBILITIES = ['private', 'employers'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];
export const DOCUMENT_VISIBILITY_LABEL: Record<DocumentVisibility, string> = { private: 'Only me and VTA', employers: 'Employers I share my profile with' };

export const learnerUploadQuery = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().trim().min(2, 'Give the document a title').max(120),
  fileName: z.string().trim().min(1).max(200),
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('private'),
});

/** How complete a profile is (EE-01: incomplete profiles can be saved). */
export function profileCompleteness(p: {
  city?: string | null;
  skillAreas?: readonly string[];
  experienceMonths?: number | null;
  education?: string | null;
  languages?: readonly string[];
  availability?: string | null;
  preferredWorkArea?: string | null;
}): { pct: number; missing: string[] } {
  const checks: [string, boolean][] = [
    ['City', !!p.city],
    ['Skills (2W, 4W, EV…)', !!p.skillAreas?.length],
    ['Experience', p.experienceMonths !== null && p.experienceMonths !== undefined && p.experienceMonths > 0],
    ['Education', !!p.education],
    ['Languages', !!p.languages?.length],
    ['Availability', !!p.availability],
    ['Preferred work area', !!p.preferredWorkArea],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([l]) => l) };
}

/** What a learner sees about each course (EE-04). "In review" hides the internal steps (returned, rejected). */
export const LEARNER_ASSESSMENT_STATE = ['not_assessed', 'in_review', 'released'] as const;
export type LearnerAssessmentState = (typeof LEARNER_ASSESSMENT_STATE)[number];
