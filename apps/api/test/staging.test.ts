import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTICE_VERSION } from '@vta/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { memoryProviders } from '../src/lib/providers.js';
import { databaseStorage } from '../src/lib/storage.js';
import { setup, type Ctx } from './helpers.js';

/** Hosted staging (Vercel): what is allowed only there, and file storage in the database. */
let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const prod = { NODE_ENV: 'production', COOKIE_SECURE: 'true', FILE_SIGNING_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h:5432/d', APP_ORIGIN: 'https://example.invalid' };

describe('staging mode', () => {
  it('production still refuses the console SMS/email stubs', () => {
    expect(() => loadConfig({ ...prod })).toThrow(/Console SMS\/email providers are not allowed/);
    expect(() => loadConfig({ ...prod, APP_ENV: 'production' })).toThrow(/not allowed/);
  });

  it('a staging copy may use them and shows sign-in codes on screen; nothing else does', () => {
    expect(loadConfig({ ...prod, APP_ENV: 'staging' }).showCodes).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development' }).showCodes).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test' }).showCodes).toBe(false);
  });

  it('staging still needs secure cookies and a signing secret', () => {
    expect(() => loadConfig({ ...prod, APP_ENV: 'staging', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ ...prod, APP_ENV: 'staging', FILE_SIGNING_SECRET: '' })).toThrow(/FILE_SIGNING_SECRET/);
  });

  it('outside staging, the sign-in code is never returned by the API', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: '+919900000201' } });
    expect(res.json()).not.toHaveProperty('stagingCode');
  });
});

describe('staging sign-up', () => {
  it('shows the organisation confirmation link on screen only on a staging copy', async () => {
    const staging = await buildApp({ db: ctx.db, config: { ...ctx.app.config, showCodes: true }, providers: memoryProviders(), storage: databaseStorage(ctx.db), logger: false });
    await staging.ready();
    try {
      const body = { type: 'employer', legalName: 'Staging Garage', sector: 'fleet', city: 'Pune', contactName: 'Sam Test', email: 'sam@staging.example', phone: '9876500000', acceptPrivacy: true, acceptTerms: true, noticeVersion: NOTICE_VERSION };
      const res = await staging.inject({ method: 'POST', url: '/api/v1/public/organisations/register', payload: body });
      expect(res.json().stagingLink).toMatch(/\/invite\/[\w-]{20,}$/);
    } finally {
      await staging.close();
    }
  });
});

describe('database file storage', () => {
  it('stores, reads and deletes a file', async () => {
    const s = databaseStorage(ctx.db);
    const key = `documents/2026/${randomUUID()}`;
    const data = Buffer.from('%PDF-1.4 test');
    await s.put(key, data);
    expect((await s.get(key)).equals(data)).toBe(true);
    await expect(s.put(key, data)).rejects.toThrow(); // never overwrites
    await s.delete(key);
    await expect(s.get(key)).rejects.toThrow(/not found/);
  });
});
