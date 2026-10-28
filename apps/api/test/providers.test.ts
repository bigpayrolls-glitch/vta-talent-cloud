import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { sslFor } from '../src/db/index.js';
import { VerifyNowSms, type OtpCheck, type Providers } from '../src/lib/providers.js';
import { databaseStorage } from '../src/lib/storage.js';
import { setup, type Ctx } from './helpers.js';

/** Real delivery: Message Central VerifyNow for sign-in codes, SMTP for email, Supabase TLS. */
const noop = () => {};
const log = { error: noop, warn: noop, info: noop, debug: noop, trace: noop, fatal: noop, child: () => log, level: 'silent', silent: noop } as unknown as FastifyBaseLogger;
const prod = { NODE_ENV: 'production', APP_ENV: 'production', COOKIE_SECURE: 'true', FILE_SIGNING_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h:5432/d', APP_ORIGIN: 'https://www.autotalentgrid.com' };
const sms = { VERIFYNOW_CUSTOMER_ID: 'C-TEST123', VERIFYNOW_KEY: 'secret pass' };
const smtp = { SMTP_HOST: 'smtp.zoho.in', SMTP_USER: 'noreply@autotalentgrid.com', SMTP_PASSWORD: 'app-pass' };

describe('settings', () => {
  it('production starts once real SMS and email settings are given', () => {
    const c = loadConfig({ ...prod, ...sms, ...smtp });
    expect(c.SMS_PROVIDER).toBe('verifynow');
    expect(c.EMAIL_PROVIDER).toBe('smtp');
    expect(c.SMTP_PORT).toBe(465);
    expect(c.showCodes).toBe(false);
  });

  it('production says which delivery is missing', () => {
    expect(() => loadConfig({ ...prod, ...sms })).toThrow(/email \(SMTP_HOST/);
    expect(() => loadConfig({ ...prod, ...smtp })).toThrow(/SMS \(VERIFYNOW_CUSTOMER_ID/);
  });

  it('a provider named without its settings is refused', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', SMS_PROVIDER: 'verifynow' })).toThrow(/VERIFYNOW_CUSTOMER_ID/);
    expect(() => loadConfig({ NODE_ENV: 'development', EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'x' })).toThrow(/SMTP_USER/);
  });

  it('a staging copy without settings keeps the console stubs and on-screen codes', () => {
    const c = loadConfig({ ...prod, APP_ENV: 'staging' });
    expect([c.SMS_PROVIDER, c.EMAIL_PROVIDER, c.showCodes]).toEqual(['console', 'console', true]);
  });
});

describe('database TLS', () => {
  it('encrypts Supabase connections and leaves other hosts as their URL says', () => {
    expect(sslFor('postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres', '')).toEqual({ rejectUnauthorized: false });
    expect(sslFor('postgresql://postgres:pw@db.abc.supabase.co:5432/postgres', 'PEM\\nLINE')).toEqual({ ca: 'PEM\nLINE' });
    expect(sslFor('postgres://u:p@ep-x.ap-southeast-1.aws.neon.tech/db?sslmode=require', '')).toBeUndefined();
    expect(sslFor('postgres://vta:vta_dev@localhost:5432/vta', '')).toBeUndefined();
  });
});

/** A fake Message Central: records calls and answers like the documented API. */
function fakeMessageCentral() {
  const calls: { path: string; params: Record<string, string>; token: string | null }[] = [];
  let tokens = 0;
  let rejectToken: string | null = null;
  const http = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const params = Object.fromEntries(url.searchParams);
    const token = (init?.headers as Record<string, string> | undefined)?.authToken ?? null;
    calls.push({ path: url.pathname, params, token });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/auth/v1/authentication/token') return json(200, { status: 200, token: `tok-${++tokens}` });
    if (token === rejectToken) return json(401, { message: 'unauthorised' });
    if (url.pathname === '/verification/v3/send') return json(200, { responseCode: 200, data: { verificationId: 'ver-1', mobileNumber: params.mobileNumber, timeout: '60' } });
    if (url.pathname === '/verification/v3/validateOtp') {
      if (params.code === '111111') return json(200, { responseCode: 200, data: { verificationStatus: 'VERIFICATION_COMPLETED' } });
      if (params.code === '000000') return json(400, { responseCode: 705, message: 'VERIFICATION_EXPIRED' });
      return json(400, { responseCode: 702, message: 'WRONG_OTP_PROVIDED' });
    }
    return json(404, {});
  }) as typeof fetch;
  return { http, calls, rejectNext: (t: string) => (rejectToken = t) };
}

describe('Message Central VerifyNow', () => {
  it('sends a 6-digit SMS code to the 10-digit number and checks the answer', async () => {
    const mc = fakeMessageCentral();
    const p = new VerifyNowSms('C-TEST123', 'secret pass', null, log, mc.http, 'https://mc.test');
    expect(await p.sendOtp('+919876543210')).toEqual({ ref: 'ver-1' });
    const [auth, send] = mc.calls;
    expect(auth!.params).toMatchObject({ customerId: 'C-TEST123', key: Buffer.from('secret pass').toString('base64'), scope: 'NEW', country: '91' });
    expect(send!.params).toMatchObject({ countryCode: '91', mobileNumber: '9876543210', flowType: 'SMS', otpLength: '6', customerId: 'C-TEST123' });
    expect(send!.token).toBe('tok-1');
    const results: OtpCheck[] = [await p.checkOtp('ver-1', '111111'), await p.checkOtp('ver-1', '222222'), await p.checkOtp('ver-1', '000000')];
    expect(results).toEqual(['ok', 'wrong', 'expired']);
    expect(mc.calls.filter((c) => c.path === '/auth/v1/authentication/token')).toHaveLength(1); // token reused
  });

  it('gets a fresh token when the old one is rejected', async () => {
    const mc = fakeMessageCentral();
    const p = new VerifyNowSms('C-TEST123', 'secret pass', 'old-token', log, mc.http, 'https://mc.test');
    mc.rejectNext('old-token');
    expect(await p.sendOtp('+919876543210')).toEqual({ ref: 'ver-1' });
    expect(mc.calls.map((c) => c.token)).toEqual(['old-token', null, 'tok-1']);
  });

  it('refuses numbers outside India', async () => {
    const p = new VerifyNowSms('C-TEST123', 'pw', null, log, fakeMessageCentral().http, 'https://mc.test');
    await expect(p.sendOtp('+447700900123')).rejects.toThrow(/Indian mobile numbers/);
  });
});

describe('signing in with codes made by the SMS provider', () => {
  let ctx: Ctx;
  const sent: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;
  const phone = '+919900000105'; // Arun, the independent trainer in the demo data

  beforeAll(async () => {
    ctx = await setup();
    let n = 0;
    const providers: Providers = {
      devEcho: false,
      email: ctx.mem.email,
      sms: {
        sendOtp: async (p) => {
          sent.push(p);
          return { ref: `ref-${++n}` };
        },
        checkOtp: async (ref, code): Promise<OtpCheck> => (code === '000000' ? 'expired' : code === `42424${ref.slice(-1)}` ? 'ok' : 'wrong'),
      },
    };
    app = await buildApp({ db: ctx.db, config: ctx.app.config, providers, storage: databaseStorage(ctx.db), logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await ctx.close();
  });

  const request = () => app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone } });
  const verify = (code: string) => app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone, code } });

  it('a wrong code counts as an attempt; the right one signs in', async () => {
    expect((await request()).statusCode).toBe(200);
    expect(sent).toEqual([phone]);
    const row = await ctx.db.selectFrom('otp_challenges').selectAll().where('phone', '=', phone).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(row).toMatchObject({ provider_ref: 'ref-1', code_hash: 'provider' });
    const wrong = await verify('999999');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.message).toMatch(/4 attempts left/);
    const ok = await verify('424241');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['set-cookie']).toBeTruthy();
  });

  it('an expired code at the provider uses the challenge up', async () => {
    await ctx.db.deleteFrom('otp_challenges').where('phone', '=', phone).execute(); // skip the resend wait
    await request();
    expect((await verify('000000')).json().error.message).toMatch(/expired/);
    expect((await verify('424242')).json().error.message).toMatch(/expired/);
  });

  it('a new number also gets a code, so the person can go on to sign up', async () => {
    const before = sent.length;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: '+919811122233' } });
    expect(res.statusCode).toBe(200);
    expect(sent.length).toBe(before + 1);
  });
});

describe('first Admin on a new live database', () => {
  it('is created once, from FIRST_ADMIN_EMAIL, and invited by email', async () => {
    const { createDb } = await import('../src/db/index.js');
    const { migrateToLatest, resetDatabase } = await import('../src/db/migrate.js');
    const { createFirstAdmin } = await import('../src/db/first-admin.js');
    const { memoryProviders } = await import('../src/lib/providers.js');
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
    const db = createDb(config.databaseUrl);
    try {
      await resetDatabase(db, 'test');
      await migrateToLatest(db, false);
      const mem = memoryProviders();
      const opts = { origin: 'https://www.autotalentgrid.com', email_: mem.email };
      expect(await createFirstAdmin(db, { ...opts })).toMatch(/Set FIRST_ADMIN_EMAIL/);
      expect(await createFirstAdmin(db, { ...opts, email: ' Owner@AutoTalentGrid.com ', name: 'Owner' })).toMatch(/invitation email has been sent/);
      const user = await db.selectFrom('users').selectAll().executeTakeFirstOrThrow();
      expect(user).toMatchObject({ email: 'owner@autotalentgrid.com', name: 'Owner', status: 'invited' });
      const role = await db.selectFrom('role_assignments').selectAll().where('user_id', '=', user.id).executeTakeFirstOrThrow();
      expect(role.role).toBe('super_admin');
      const first = mem.sentInvites.get('owner@autotalentgrid.com');
      expect(first).toMatch(/^https:\/\/www\.autotalentgrid\.com\/invite\/[\w-]{20,}$/);

      // Not accepted yet: the next deploy emails a fresh link (the old one stops working).
      expect(await createFirstAdmin(db, { ...opts, email: 'owner@autotalentgrid.com' })).toMatch(/Invitation sent again/);
      expect(mem.sentInvites.get('owner@autotalentgrid.com')).not.toBe(first);
      // A changed address (the first was mistyped) gets its own Admin invitation.
      expect(await createFirstAdmin(db, { ...opts, email: 'admin@autotalentgrid.com' })).toMatch(/First Admin created for admin@autotalentgrid.com/);
      expect(await db.selectFrom('users').select('id').execute()).toHaveLength(2);

      // Once an Admin is active, nothing more happens.
      await db.updateTable('users').set({ status: 'active' }).where('email', '=', 'admin@autotalentgrid.com').execute();
      mem.sentInvites.clear();
      expect(await createFirstAdmin(db, { ...opts, email: 'someone@else.com' })).toMatch(/already active/);
      expect(mem.sentInvites.size).toBe(0);
    } finally {
      await db.destroy();
    }
  });
});

describe('database connections', () => {
  it('an idle connection closed by the database does not stop the server; the pool carries on', async () => {
    const { createPool } = await import('../src/db/index.js');
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
    const dropped: string[] = [];
    const pool = createPool(config.databaseUrl, 2, (msg) => dropped.push(msg));
    try {
      const client = await pool.connect();
      const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
      client.release(); // now idle in the pool
      const killer = createPool(config.databaseUrl, 1, () => {});
      await killer.query('select pg_terminate_backend($1)', [rows[0]!.pid]);
      await killer.end();
      await new Promise((r) => setTimeout(r, 300));
      expect(dropped).toEqual(['Database connection dropped while idle; it was discarded']);
      expect((await pool.query('select 1 as ok')).rows[0]).toEqual({ ok: 1 });
    } finally {
      await pool.end();
    }
  });
});
