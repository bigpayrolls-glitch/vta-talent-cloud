import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url().default('postgres://vta:vta_dev@localhost:5432/vta'),
  TEST_DATABASE_URL: z.string().url().default('postgres://vta:vta_dev@localhost:5432/vta_test'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  SMS_PROVIDER: z.enum(['console']).default('console'),
  EMAIL_PROVIDER: z.enum(['console']).default('console'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Where uploaded files are kept. Only 'local' exists until hosting is chosen (D10). */
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_DIR: z.string().default('.storage'),
  /** Name printed as the issuer on credentials and the verify page (decision D8: the legal entity). */
  CREDENTIAL_ISSUER_NAME: z.string().trim().min(2).max(120).default('VTA Talent Cloud'),
  /** Secret for signing file download links. Required in production; random per start in development. */
  FILE_SIGNING_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(32, 'FILE_SIGNING_SECRET must be at least 32 characters').optional(),
  ),
});

export type Config = Omit<z.infer<typeof envSchema>, 'FILE_SIGNING_SECRET'> & { databaseUrl: string; fileSigningSecret: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  if (parsed.NODE_ENV === 'production') {
    // Console providers print codes and links to the log. Never allowed in production (plan §3.6).
    if (parsed.SMS_PROVIDER === 'console' || parsed.EMAIL_PROVIDER === 'console') {
      throw new Error('Console SMS/email providers are not allowed when NODE_ENV=production. Configure a real provider.');
    }
    if (!parsed.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production.');
    if (!parsed.FILE_SIGNING_SECRET) throw new Error('FILE_SIGNING_SECRET is required in production.');
  }
  const { FILE_SIGNING_SECRET, ...rest } = parsed;
  return {
    ...rest,
    databaseUrl: parsed.NODE_ENV === 'test' ? parsed.TEST_DATABASE_URL : parsed.DATABASE_URL,
    fileSigningSecret: FILE_SIGNING_SECRET ?? randomBytes(32).toString('base64url'),
  };
}
