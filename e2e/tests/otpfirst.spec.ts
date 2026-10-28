import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearOtp, latestOtp } from './helpers.js';

/** 28 Oct 2026: a learner just enters their number. A new number is checked once, then goes to a short sign-up. */
const here = path.dirname(fileURLToPath(import.meta.url));

test('a new number signs in with an OTP and is taken to create the account, without a second code', async ({ page }) => {
  const phone = '9811177788';
  await clearOtp(phone);
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Mobile number' }).click();
  await page.getByLabel('Mobile number').fill(phone);
  const logSize = readFileSync(path.join(here, '../.api.log'), 'utf8').length;
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await expect(page.getByText(/A code has been sent to \+91 9811177788/)).toBeVisible();
  await page.getByLabel('6-digit code').fill(await latestOtp(phone.slice(-2), logSize));
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.getByText('Mobile number +91 9811177788 verified')).toBeVisible();
  await expect(page.getByLabel('Mobile number')).toHaveCount(0);
  await page.getByLabel('Full name').fill('Kavya Rao');
  await page.getByLabel('Date of birth').fill('2000-03-14');
  await page.getByLabel('City or town').fill('Hubballi');
  await page.getByLabel('I have read the privacy notice').check();
  await page.getByLabel('I agree to the terms of use').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello, Kavya!');
});
