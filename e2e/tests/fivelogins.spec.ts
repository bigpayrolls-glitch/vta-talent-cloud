import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiLogSize, clearOtp, EMAIL, latestOtp, signInEmail } from './helpers.js';

/** Five logins (27 Oct 2026): Admin, Employer, Learner, Trainer and Training Partner. */

test('an independent trainer signs up; an Admin verifies them', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Trainers: sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Sign up as a trainer' })).toBeVisible();
  const phone = '9811155566';
  await clearOtp(phone);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Full name').fill('Sunil Freelance');
  await page.getByLabel('City or town').fill('Hubballi');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Choose at least one skill area')).toBeVisible();
  await page.getByRole('group').getByText('Four-wheeler').click();
  await page.getByLabel('Years of training or workshop experience').fill('6');
  await page.getByLabel('I have read the privacy notice').check();
  await page.getByLabel('I agree to the terms of use').check();
  const log = apiLogSize();
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill(await latestOtp(phone.slice(-2), log));
  await page.getByRole('button', { name: 'Create trainer account' }).click();
  await expect(page).toHaveURL(/\/partner$/);
  await expect(page.getByText('You are an independent trainer.')).toBeVisible();

  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await signInEmail(admin, EMAIL.superAdmin);
  await admin.goto('/admin/trainers?verificationStatus=pending');
  await admin.getByRole('link', { name: /Sunil Freelance/ }).click();
  await expect(admin.getByText(/Signed up as an independent trainer, Hubballi, 6 years experience/)).toBeVisible();
  await admin.getByRole('button', { name: 'Verify' }).click();
  await expect(admin.getByText('Trainer verified')).toBeVisible();
  await ctx.close();
});

test('a training partner runs everything for its centres: no Team page, its trainers, a batch with an independent trainer', async ({ page }) => {
  await signInEmail(page, EMAIL.partnerAdminA);
  const nav = page.getByRole('navigation', { name: 'Training Partner Portal' });
  await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Trainers' }).click();
  await expect(page.getByRole('heading', { name: 'Trainers' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Arun Independent Trainer/ })).toBeVisible();
  await expect(page.getByText('Independent trainer, no centre yet').first()).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);

  await nav.getByRole('link', { name: 'Batches' }).click();
  await page.getByRole('button', { name: 'Create batch' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Batch name').fill(`4W Peenya with Arun ${Date.now()}`);
  await dialog.getByLabel('Course').selectOption({ label: '4W Service Technician (4W-ST-01)' });
  await dialog.getByLabel('Centre').selectOption({ index: 1 });
  await expect(dialog.getByLabel('Trainer').locator('option', { hasText: 'Arun Independent Trainer' })).toHaveCount(1);
  await dialog.getByLabel('Trainer').selectOption({ label: 'Arun Independent Trainer (4W, 2W), independent' });
  await dialog.getByLabel('Start date').fill('2026-12-01');
  await dialog.getByLabel('End date').fill('2027-03-01');
  await dialog.getByRole('button', { name: /Create batch/ }).click();
  await expect(page).toHaveURL(/\/partner\/batches\/[0-9a-f-]+$/);
  await expect(page.getByText('Arun Independent Trainer').first()).toBeVisible();
});
