import { z } from 'zod';
import { ROLES } from './roles.js';

/** Shared request schemas. The browser validates forms with these; the API validates requests with the same. */

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

/** Indian mobile numbers, stored in E.164 form (+91XXXXXXXXXX). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (v.startsWith('+') ? v : v.length === 10 ? `+91${v}` : `+${v}`))
  .refine((v) => /^\+91[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const nameSchema = z.string().trim().min(2, 'Enter a name').max(120);

export const uuidSchema = z.string().uuid();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});

/** `register` sends a code to any number (to create an account); `login` only to registered numbers. */
export const otpRequestSchema = z.object({ phone: phoneSchema, purpose: z.enum(['login', 'register']).default('login') });
export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const acceptInvitationSchema = z.object({ password: passwordSchema });

export const inviteUserSchema = z
  .object({
    name: nameSchema,
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Give an email or a phone number', path: ['email'] });

export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
export const optionalReasonSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const grantRoleSchema = z.object({
  userId: uuidSchema,
  role: z.enum(ROLES),
  organisationId: uuidSchema.optional(),
  centreId: uuidSchema.optional(),
});

export const ORG_TYPES = ['employer', 'partner'] as const;
export const PARTNER_SUBTYPES = ['oem', 'csr_sponsor', 'ngo', 'college', 'training_provider', 'automotive_company', 'other'] as const;

export const createOrganisationSchema = z
  .object({
    type: z.enum(ORG_TYPES),
    partnerSubtype: z.enum(PARTNER_SUBTYPES).optional(),
    legalName: z.string().trim().min(2).max(200),
    registrationIds: z.record(z.string(), z.string().max(100)).default({}),
    address: z.string().trim().max(500).optional(),
    contactName: z.string().trim().max(120).optional(),
    contactEmail: emailSchema.optional(),
    contactPhone: phoneSchema.optional(),
  })
  .refine((v) => v.type !== 'partner' || v.partnerSubtype, {
    message: 'Choose the partner type',
    path: ['partnerSubtype'],
  });

/** A Google Maps link pasted for a centre (google.com/maps, maps.google.com, maps.app.goo.gl or goo.gl/maps). */
export const mapUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)(\/|\?|$)/i.test(v), 'Paste a Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…)');

export const centreSchema = z
  .object({
    name: z.string('Enter the centre name').trim().min(2, 'Enter the centre name').max(160),
    organisationId: uuidSchema.optional(), // empty = AutoTalent Grid-run centre
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(80).optional(),
    contactPhone: phoneSchema.optional(),
    /** GPS position, from the person's phone with their permission. Both or neither. */
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    mapUrl: mapUrlSchema.or(z.literal('')).nullable().optional(),
  });

/** A training partner adds a centre for its own organisation: the city is needed so learners can find it. */
export const partnerCentreSchema = centreSchema.omit({ organisationId: true }).extend({ city: z.string('Enter the city').trim().min(2, 'Enter the city').max(80) });

/** Where a centre is on Google Maps: its pasted link, or a link to its GPS position. Needs no Google key. */
export function centreMapLink(c: { latitude: number | null; longitude: number | null; mapUrl: string | null }): string | null {
  if (c.mapUrl) return c.mapUrl;
  if (c.latitude != null && c.longitude != null) return `https://www.google.com/maps?q=${c.latitude.toFixed(6)},${c.longitude.toFixed(6)}`;
  return null;
}

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type GrantRoleInput = z.infer<typeof grantRoleSchema>;
export type CreateOrganisationInput = z.infer<typeof createOrganisationSchema>;
export type CentreInput = z.infer<typeof centreSchema>;

// Phase 9: password reset (by email link) and change (signed in).
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(100), password: passwordSchema });
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password').max(128), newPassword: passwordSchema })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'Choose a password different from the current one' });

/** Phase 9: a learner asks VTA to close their account (the reason is optional). */
export const closureRequestSchema = z.object({ reason: z.string().trim().max(500).optional() });

/** Phase 11: VTA changes the mobile number someone signs in with, after checking who they are. */
export const changePhoneSchema = z.object({
  phone: phoneSchema,
  reason: z.string().trim().min(3, 'Say how you checked who they are').max(500),
});
