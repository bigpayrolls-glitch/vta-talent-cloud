import { expect, test } from '@playwright/test';
import { EMAIL, expectNoHorizontalScroll, signInEmail } from './helpers.js';

/** Phase 12: employer plans, a test payment and the invoice. Employer B starts on Starter (seed). */

test('an employer admin upgrades to Growth with a test payment and gets an invoice', async ({ page }) => {
  await signInEmail(page, EMAIL.employerAdminB);
  await expect(page.getByRole('heading', { name: /Your current plan/ })).toContainText('Starter');

  await page.getByRole('link', { name: 'Manage plan' }).click();
  await expect(page.getByRole('heading', { name: 'Subscription', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Change plan' }).click();
  await expect(page.getByRole('heading', { name: 'Simple plans for your hiring needs' })).toBeVisible();
  await page.getByRole('radio', { name: /Yearly/ }).click();
  await expect(page.getByText('₹28,790')).toBeVisible();
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await page.getByRole('link', { name: 'Choose Growth' }).click();

  await expect(page.getByRole('heading', { name: 'Growth Plan' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue to payment' }).click();
  await expect(page.getByRole('heading', { name: 'Payment details' })).toBeVisible();
  await expect(page.getByText('replaces your Starter plan straight away')).toBeVisible();
  await page.getByRole('radio', { name: 'UPI' }).click();
  await expect(page.getByRole('note')).toContainText('no money is taken');
  await page.getByRole('button', { name: 'Pay ₹2,999' }).click();
  await expect(page.getByRole('alert')).toContainText('Accept the terms');
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Pay ₹2,999' }).click();

  await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible();
  await expect(page.getByText('Your Growth plan is now active.')).toBeVisible();
  const invoice = page.getByRole('article', { name: /Invoice INV-/ });
  await expect(invoice).toContainText('Metro Auto Works (demo)');
  await expect(invoice).toContainText('Not a tax invoice');
  await page.getByRole('link', { name: 'Go to dashboard' }).click();
  await expect(page.getByRole('heading', { name: /Your current plan/ })).toContainText('Growth');

  await page.goto('/employer/subscription');
  await expect(page.getByRole('link', { name: /INV-\d{8}-\d{4}/ }).first()).toBeVisible();
});

test('a recruiter sees the plan but cannot buy one; the plan pages fit a phone', async ({ page }) => {
  await signInEmail(page, EMAIL.recruiterA);
  await page.goto('/employer/subscription');
  await expect(page.getByText('Only your company’s employer admin can change the plan.').or(page.getByText("Only your company's employer admin can change the plan."))).toBeVisible();
  await expect(page.getByRole('link', { name: 'Change plan' })).toHaveCount(0);
  await page.goto('/employer/subscription/plans/starter');
  await expect(page.getByText('Only your company’s employer admin can buy a plan.').or(page.getByText("Only your company's employer admin can buy a plan."))).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/employer/subscription', '/employer/subscription/plans']) {
    await page.goto(path);
    await expectNoHorizontalScroll(page);
  }
});
