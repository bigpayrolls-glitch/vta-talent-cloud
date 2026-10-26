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

export const centreSchema = z.object({
  name: z.string().trim().min(2).max(160),
  organisationId: uuidSchema.optional(), // empty = VTA-run centre
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(80).optional(),
  contactPhone: phoneSchema.optional(),
});

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
