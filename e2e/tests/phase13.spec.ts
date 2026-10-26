import { expect, test } from '@playwright/test';
import { apiLogSize, clearOtp, expectNoHorizontalScroll, latestOtp } from './helpers.js';

/** Phase 13: browse courses without signing in, create an account while enrolling, pay (test) and see it in My Courses. */

test('a visitor finds a course, creates an account while enrolling, pays and sees it in My Courses', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('main').getByRole('link', { name: 'Explore training' }).click();
  await expect(page.getByRole('heading', { name: 'Training courses' })).toBeVisible();
  await expect(page.getByText(/\d+ courses? with batches open/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '2W Service Technician', exact: true })).toBeVisible();

  await page.getByLabel('Electric vehicle').click();
  await expect(page.getByLabel('Electric vehicle')).toBeChecked();
  await expect(page.getByRole('heading', { name: 'EV Technician', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2W Service Technician', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Sort by').selectOption('fee_asc');
  await page.getByRole('link', { name: 'View details: 2W Service Technician', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('2W Service Technician');
  await expect(page.getByText('₹4,999').first()).toBeVisible();
  await expect(page.getByText('Engine servicing').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Certification' }).click();
  await expect(page.getByText(/Attend at least 75%/)).toBeVisible();
  await page.getByRole('link', { name: 'Enrol now: 2W Peenya November 2026' }).click();

  await expect(page.getByRole('heading', { name: 'Sign in to enrol' })).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  const phone = '9811144455';
  await clearOtp(phone);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Full name').fill('Lakshmi Devi');
  await page.getByLabel('Date of birth').fill('2002-04-04');
  await page.getByLabel('City or town').fill('Bengaluru');
  await page.getByLabel('I have read the privacy notice').check();
  await page.getByLabel('I agree to the terms of use').check();
  const log = apiLogSize();
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill(await latestOtp(phone.slice(-2), log));
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/enrol\//);
  await expect(page.getByRole('heading', { name: 'Selected course' })).toBeVisible();
  await expect(page.getByText('2W Peenya November 2026')).toBeVisible();
  await page.getByRole('radio', { name: 'Debit or credit card' }).check();
  await expect(page.getByRole('note')).toContainText('no money is taken');
  await page.getByRole('button', { name: 'Pay ₹4,999' }).click();
  await expect(page.getByRole('alert')).toContainText('Accept the terms');
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Pay ₹4,999' }).click();

  await expect(page.getByRole('heading', { name: 'Enrolment successful!' })).toBeVisible();
  await expect(page.getByText(/ATG-ENR-\d{8}-\d{4}/)).toBeVisible();
  await expect(page.getByText('Paid (test)')).toBeVisible();
  await page.getByRole('link', { name: 'Go to My Courses' }).click();
  await expect(page.getByRole('heading', { name: 'My Courses' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2W Service Technician', exact: true })).toBeVisible();
  await expect(page.getByText('Upcoming')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receipt' })).toBeVisible();

  // Enrolling again in the same batch is refused.
  await page.goto('/courses');
  await page.getByRole('link', { name: 'View details: 2W Service Technician', exact: true }).click();
  await page.getByRole('link', { name: 'Enrol now: 2W Peenya November 2026' }).click();
  await expect(page.getByText('You are already enrolled in this batch.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay/ })).toHaveCount(0);
});

test('the course list and a course page fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/courses');
  await expect(page.getByRole('heading', { name: 'Training courses' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
  await page.getByRole('button', { name: /Show \d+ courses/ }).click();
  await page.getByRole('link', { name: /View details/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Upcoming batches' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
