import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../apps/api/src/db/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, '../.auth/credentials.json'), 'utf8')) as {
  credentials: { login: string; password?: string }[];
  ids: Record<string, string>;
};

export const ids = data.ids;

export function passwordOf(email: string): string {
  const c = data.credentials.find((x) => x.login === email);
  if (!c?.password) throw new Error(`No demo password for ${email}`);
  return c.password;
}

export async function signInEmail(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(passwordOf(email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** Reads the newest development OTP code for this number from the API log. */
export async function latestOtp(phoneEnding: string, after: number): Promise<string> {
  const log = path.join(here, '../.api.log');
  for (let i = 0; i < 40; i++) {
    const text = readFileSync(log, 'utf8').slice(after);
    const matches = [...text.matchAll(/OTP code: (\d{6})/g)];
    if (matches.length && text.includes(phoneEnding)) return matches.at(-1)![1]!;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('No OTP code found in the API log');
}

/** Runs a query against the browser-test database (to check what the server saved). */
export async function withDb<T>(fn: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
  const db = createDb(process.env.E2E_DATABASE_URL ?? 'postgres://vta:vta_dev@localhost:5432/vta_e2e');
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

/** Clears earlier sign-in codes for a number so repeated test sign-ins are not held up by the 60-second resend gap. */
export async function clearOtp(tenDigits: string) {
  const db = createDb(process.env.E2E_DATABASE_URL ?? 'postgres://vta:vta_dev@localhost:5432/vta_e2e');
  try {
    await db.deleteFrom('otp_challenges').where('phone', '=', `+91${tenDigits}`).execute();
  } finally {
    await db.destroy();
  }
}

export async function signInPhone(page: Page, tenDigits: string) {
  await clearOtp(tenDigits);
  const logSize = readFileSync(path.join(here, '../.api.log'), 'utf8').length;
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Mobile number' }).click();
  await page.getByLabel('Mobile number').fill(tenDigits);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  const code = await latestOtp(tenDigits.slice(-2), logSize);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

export const EMAIL = {
  superAdmin: 'superadmin@demo.vta.local',
  opsAdmin: 'ops@demo.vta.local',
  centreAdmin: 'centre@demo.vta.local',
  employerAdminA: 'employer-a@demo.vta.local',
  recruiterA: 'recruiter-a@demo.vta.local',
  employerAdminB: 'employer-b@demo.vta.local',
  employerAdminPending: 'employer-pending@demo.vta.local',
  partnerAdminA: 'partner-a@demo.vta.local',
  partnerViewerA: 'viewer-a@demo.vta.local',
  partnerAdminB: 'partner-b@demo.vta.local',
  multi: 'multi@demo.vta.local',
};

/** True when the page has no horizontal scrolling (responsive check). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
}

/** Size of the API log now, so later reads only look at what was written after this point. */
export const apiLogSize = () => readFileSync(path.join(here, '../.api.log'), 'utf8').length;

/** Reads the newest development confirmation link for an organisation registration from the API log. */
export async function latestSignupLink(name: string, after: number): Promise<string> {
  const log = path.join(here, '../.api.log');
  for (let i = 0; i < 40; i++) {
    const text = readFileSync(log, 'utf8').slice(after);
    const m = [...text.matchAll(new RegExp(`Confirm registration for ${name}: (\\S+)`, 'g'))];
    if (m.length) return new URL(m.at(-1)![1]!).pathname;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('No confirmation link found in the API log');
}
