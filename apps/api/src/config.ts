import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * staging: a hosted copy with demo data only (for example on Vercel). Console SMS/email are allowed there,
   * and sign-in codes and invitation links are shown on screen, because no provider is chosen yet (D10).
   * Never use staging with real people's data.
   */
  APP_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  API_PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url().default('postgres://vta:vta_dev@localhost:5432/vta'),
  TEST_DATABASE_URL: z.string().url().default('postgres://vta:vta_dev@localhost:5432/vta_test'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  /**
   * 'verifynow': Message Central VerifyNow sends and checks the sign-in codes (same account as PF Mitra).
   * 'smtp': emails go out through a mailbox's SMTP server (for example Zoho Mail).
   * Left unset, each is chosen from whether its settings are present; 'console' only prints (local and staging).
   */
  SMS_PROVIDER: z.enum(['console', 'verifynow']).optional(),
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).optional(),
  VERIFYNOW_CUSTOMER_ID: z.preprocess(blank, z.string().trim().min(3).optional()),
  /** The Message Central account password; a fresh auth token is made from it. */
  VERIFYNOW_KEY: z.preprocess(blank, z.string().optional()),
  /** Or a ready auth token from the Message Central console (used as is until it is rejected). */
  VERIFYNOW_AUTH_TOKEN: z.preprocess(blank, z.string().trim().optional()),
  SMTP_HOST: z.preprocess(blank, z.string().trim().optional()),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.preprocess(blank, z.string().trim().optional()),
  SMTP_PASSWORD: z.preprocess(blank, z.string().optional()),
  /** Sender shown on emails, for example "AutoTalent Grid <noreply@autotalentgrid.com>". Defaults to SMTP_USER. */
  EMAIL_FROM: z.preprocess(blank, z.string().trim().optional()),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Where uploaded files are kept: 'local' disk, or 'database' (in PostgreSQL) for hosts without a disk such as
   * Vercel staging. Production should use object storage once hosting is chosen (D10).
   */
  STORAGE_DRIVER: z.enum(['local', 'database']).default('local'),
  STORAGE_DIR: z.string().default('.storage'),
  /** Name printed as the issuer on credentials and the verify page (decision D8: the legal entity). */
  CREDENTIAL_ISSUER_NAME: z.string().trim().min(2).max(120).default('AutoTalent Grid'),
  /**
   * Phase 12: how employers pay for a plan. 'test' completes a marked test payment with no money moving
   * (allowed on local and staging only); 'none' means employers ask AutoTalent Grid and an admin sets the plan.
   * A real payment provider (for example Razorpay) needs an account and keys from AutoTalent Grid.
   */
  PAYMENT_MODE: z.enum(['test', 'none']).optional(),
  /** Secret for signing file download links. Required in production; random per start in development. */
  FILE_SIGNING_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(32, 'FILE_SIGNING_SECRET must be at least 32 characters').optional(),
  ),
});

type Env = z.infer<typeof envSchema>;

export type Config = Omit<Env, 'FILE_SIGNING_SECRET' | 'SMS_PROVIDER' | 'EMAIL_PROVIDER'> & {
  SMS_PROVIDER: 'console' | 'verifynow';
  EMAIL_PROVIDER: 'console' | 'smtp';
  databaseUrl: string;
  fileSigningSecret: string;
  /** Staging only: return sign-in codes to the screen (there is no SMS provider yet). */
  showCodes: boolean;
  paymentMode: 'test' | 'none';
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = envSchema.parse(env);
  const hasVerifyNow = !!raw.VERIFYNOW_CUSTOMER_ID && !!(raw.VERIFYNOW_KEY || raw.VERIFYNOW_AUTH_TOKEN);
  const hasSmtp = !!raw.SMTP_HOST && !!raw.SMTP_USER && !!raw.SMTP_PASSWORD;
  const parsed = {
    ...raw,
    SMS_PROVIDER: raw.SMS_PROVIDER ?? (hasVerifyNow ? 'verifynow' : 'console'),
    EMAIL_PROVIDER: raw.EMAIL_PROVIDER ?? (hasSmtp ? 'smtp' : 'console'),
  } as const;
  if (parsed.SMS_PROVIDER === 'verifynow' && !hasVerifyNow) {
    throw new Error('SMS_PROVIDER=verifynow needs VERIFYNOW_CUSTOMER_ID and VERIFYNOW_KEY (or VERIFYNOW_AUTH_TOKEN).');
  }
  if (parsed.EMAIL_PROVIDER === 'smtp' && !hasSmtp) throw new Error('EMAIL_PROVIDER=smtp needs SMTP_HOST, SMTP_USER and SMTP_PASSWORD.');
  if (parsed.NODE_ENV === 'production') {
    // Console providers print codes and links to the log. Never allowed in production (plan §3.6);
    // a staging copy with demo data may use them.
    if (parsed.APP_ENV !== 'staging' && (parsed.SMS_PROVIDER === 'console' || parsed.EMAIL_PROVIDER === 'console')) {
      const missing = [parsed.SMS_PROVIDER === 'console' && 'SMS (VERIFYNOW_CUSTOMER_ID, VERIFYNOW_KEY)', parsed.EMAIL_PROVIDER === 'console' && 'email (SMTP_HOST, SMTP_USER, SMTP_PASSWORD)'].filter(Boolean);
      throw new Error(`Console SMS/email providers are not allowed when NODE_ENV=production. Configure a real provider: ${missing.join('; ')}.`);
    }
    if (!parsed.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production.');
    if (!parsed.FILE_SIGNING_SECRET) throw new Error('FILE_SIGNING_SECRET is required in production.');
  }
  if (parsed.APP_ENV === 'production' && parsed.PAYMENT_MODE === 'test') throw new Error('PAYMENT_MODE=test is not allowed in production.');
  const { FILE_SIGNING_SECRET, ...rest } = parsed;
  return {
    ...rest,
    databaseUrl: parsed.NODE_ENV === 'test' ? parsed.TEST_DATABASE_URL : parsed.DATABASE_URL,
    fileSigningSecret: FILE_SIGNING_SECRET ?? randomBytes(32).toString('base64url'),
    showCodes: parsed.APP_ENV === 'staging' && parsed.SMS_PROVIDER === 'console',
    paymentMode: parsed.PAYMENT_MODE ?? (parsed.APP_ENV === 'production' ? 'none' : 'test'),
  };
}
