import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type DB } from '../src/db/index.js';
import { migrateToLatest, resetDatabase } from '../src/db/migrate.js';
import { seed, type SeedResult } from '../src/db/seed.js';
import { memoryProviders } from '../src/lib/providers.js';
import { localStorage } from '../src/lib/storage.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type Mem = ReturnType<typeof memoryProviders>;

export interface Ctx {
  app: FastifyInstance;
  db: DB;
  seeded: SeedResult;
  mem: Mem;
  ids: Record<string, string>;
  passwordOf(email: string): string;
  close(): Promise<void>;
}

/** Fresh database + seeded demo data + app with in-memory SMS/email capture. */
export async function setup(): Promise<Ctx> {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  const db = createDb(config.databaseUrl);
  await resetDatabase(db, 'test');
  await migrateToLatest(db, false);
  const seeded = await seed(db);
  const mem = memoryProviders();
  const storageDir = mkdtempSync(path.join(tmpdir(), 'vta-test-files-'));
  const app = await buildApp({ db, config, providers: mem, storage: localStorage(storageDir), logger: false });
  await app.ready();
  return {
    app,
    db,
    seeded,
    mem,
    ids: seeded.ids,
    passwordOf(email) {
      const c = seeded.credentials.find((x) => x.login === email);
      if (!c?.password) throw new Error(`No password for ${email}`);
      return c.password;
    },
    async close() {
      await app.close();
      await db.destroy();
    },
  };
}

export interface Client {
  cookie: string;
  csrf: string;
  get(url: string): Promise<{ status: number; body: any }>;
  post(url: string, body?: unknown, opts?: { csrf?: string | null }): Promise<{ status: number; body: any }>;
  patch(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  put(url: string, body?: unknown): Promise<{ status: number; body: any }>;
  upload(url: string, data: Buffer, contentType?: string): Promise<{ status: number; body: any }>;
}

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const list = Array.isArray(set) ? set : [set];
  const session = list.find((c) => typeof c === 'string' && c.startsWith('vta_session='));
  if (!session) throw new Error('No session cookie set');
  return (session as string).split(';')[0]!;
}

export async function clientFromCookie(app: FastifyInstance, cookie: string): Promise<Client> {
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
  const csrf = me.statusCode === 200 ? (me.json().csrfToken as string) : '';
  const send = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, body?: unknown, token: string | null = csrf) => {
    const headers: Record<string, string> = { cookie };
    if (token && method !== 'GET') headers['x-csrf-token'] = token;
    const res = await app.inject({ method, url: `/api/v1${url}`, headers, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  return {
    cookie,
    csrf,
    get: (url) => send('GET', url),
    post: (url, body, opts) => send('POST', url, body ?? {}, opts?.csrf === undefined ? csrf : opts.csrf),
    patch: (url, body) => send('PATCH', url, body ?? {}),
    put: (url, body) => send('PUT', url, body ?? {}),
    upload: async (url, data, contentType = 'application/octet-stream') => {
      const res = await app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, 'x-csrf-token': csrf, 'content-type': contentType }, payload: data });
      return { status: res.statusCode, body: res.body ? res.json() : null };
    },
  };
}

/** Each sign-in comes from a different test IP, so the per-IP rate limits only bite in the test that targets them. */
let ipCounter = 0;
export const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`;

export async function loginEmail(ctx: Ctx, email: string, password = ctx.passwordOf(email)): Promise<Client> {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, remoteAddress: nextIp() });
  if (res.statusCode !== 200) throw new Error(`Login failed for ${email}: ${res.statusCode} ${res.body}`);
  return clientFromCookie(ctx.app, cookieFrom(res));
}

export async function loginPhone(ctx: Ctx, phone: string): Promise<Client> {
  // Tests bypass the 60-second resend gap by clearing earlier challenges for this number.
  await ctx.db.deleteFrom('otp_challenges').where('phone', '=', phone).execute();
  const r1 = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone }, remoteAddress: nextIp() });
  if (r1.statusCode !== 200) throw new Error(`OTP request failed: ${r1.body}`);
  const code = ctx.mem.sentOtps.get(phone);
  if (!code) throw new Error(`No OTP sent to ${phone}`);
  const r2 = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone, code }, remoteAddress: nextIp() });
  if (r2.statusCode !== 200) throw new Error(`OTP verify failed: ${r2.body}`);
  return clientFromCookie(ctx.app, cookieFrom(r2));
}

export { cookieFrom };

/** Demo sign-ins by key. */
export const EMAIL = {
  superAdmin: 'superadmin@demo.vta.local',
  opsAdmin: 'ops@demo.vta.local',
  centreAdmin: 'centre@demo.vta.local',
  employerAdminA: 'employer-a@demo.vta.local',
  recruiterA: 'recruiter-a@demo.vta.local',
  employerAdminB: 'employer-b@demo.vta.local',
  partnerAdminA: 'partner-a@demo.vta.local',
  partnerViewerA: 'viewer-a@demo.vta.local',
  partnerAdminB: 'partner-b@demo.vta.local',
  multi: 'multi@demo.vta.local',
  pending: 'pending@demo.vta.local',
} as const;

export const PHONE = {
  trainerA: '+919900000101',
  trainerVta: '+919900000102',
  trainerB: '+919900000103',
  trainerPending: '+919900000104',
  learner: '+919900000201',
} as const;
