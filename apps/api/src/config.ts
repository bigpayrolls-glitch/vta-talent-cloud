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
});

export type Config = z.infer<typeof envSchema> & { databaseUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  if (parsed.NODE_ENV === 'production') {
    // Console providers print codes and links to the log. Never allowed in production (plan §3.6).
    if (parsed.SMS_PROVIDER === 'console' || parsed.EMAIL_PROVIDER === 'console') {
      throw new Error('Console SMS/email providers are not allowed when NODE_ENV=production. Configure a real provider.');
    }
    if (!parsed.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production.');
  }
  return {
    ...parsed,
    databaseUrl: parsed.NODE_ENV === 'test' ? parsed.TEST_DATABASE_URL : parsed.DATABASE_URL,
  };
}
