import { expect, test, type Page } from '@playwright/test';
import { apiLogSize, EMAIL, expectNoHorizontalScroll, ids, latestEmailLink, passwordOf, signInEmail, signInPhone } from './helpers.js';

/** Phase 9: notifications, password reset/change, learner data download and closure request. */

async function apiPost(page: Page, url: string, data: unknown) {
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const res = await page.request.post(`/api/v1${url}`, { data, headers: { 'x-csrf-token': me.csrfToken } });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

test('an AutoTalent Grid decision shows on the bell; opening it goes to the right page and marks it read', async ({ page, browser }) => {
  await signInEmail(page, EMAIL.opsAdmin);
  await apiPost(page, `/admin/organisations/${ids.employerPending}/request-info`, { reason: 'Please upload a clearer GST certificate' });

  const ctx = await browser.newContext();
  const emp = await ctx.newPage();
  await signInEmail(emp, EMAIL.employerAdminPending);
  const bell = emp.getByRole('link', { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(emp).toHaveURL(/\/employer\/notifications$/);
  const item = emp.getByRole('button', { name: /AutoTalent Grid needs more information/ }).first();
  await expect(item).toContainText('clearer GST certificate');
  await expect(item).toContainText('(unread)');
  await item.click();
  await expect(emp).toHaveURL(/\/employer\/company$/);

  await emp.goto('/employer/notifications');
  await expect(emp.getByRole('button', { name: /AutoTalent Grid needs more information/ }).first()).not.toContainText('(unread)');
  const markAll = emp.getByRole('button', { name: 'Mark all as read' });
  if (await markAll.isVisible()) await markAll.click();
  await expect(emp.getByText('You are up to date.')).toBeVisible();
  await expect(emp.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
  await ctx.close();
});

test('forgot password: the link sets a new password; then it is changed back from the account page', async ({ page }) => {
  const email = EMAIL.partnerViewerA;
  const original = passwordOf(email);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(email);
  const after = apiLogSize();
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await latestEmailLink('Password reset', 'Sanjay Viewer A', after));
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('Temporary-pass-91');
  await page.getByLabel('Confirm new password').fill('Temporary-pass-92');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('The passwords don’t match')).toBeVisible();
  await page.getByLabel('Confirm new password').fill('Temporary-pass-91');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Temporary-pass-91');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Change password' }).click();
  await page.getByLabel('Current password').fill('wrong-one');
  await page.getByLabel('New password', { exact: true }).fill(original);
  await page.getByLabel('Confirm new password').fill(original);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('This is not your current password')).toBeVisible();
  await page.getByLabel('Current password').fill('Temporary-pass-91');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible();
});

test('a learner downloads their data and can ask to close the account, then cancel', async ({ page }) => {
  await signInPhone(page, '9900000201');
  await page.goto('/learn/privacy');
  const wasOn = (await page.getByRole('switch', { name: 'Employers can find my profile' }).getAttribute('aria-checked')) === 'true';

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^vta-talent-cloud-my-data-\d{4}-\d{2}-\d{2}\.json$/);

  await page.getByRole('button', { name: 'Ask to close my account' }).click();
  await page.getByLabel('Reason (optional)').fill('Testing');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText(/You asked AutoTalent Grid to close your account on/)).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Employers can find my profile' })).toHaveAttribute('aria-checked', 'false');
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Cancel my request' }).click();
  await expect(page.getByRole('button', { name: 'Ask to close my account' })).toBeVisible();
  // Put search visibility back as it was, for the tests that follow.
  if (wasOn) {
    await page.getByRole('switch', { name: 'Employers can find my profile' }).click();
    await expect(page.getByRole('switch', { name: 'Employers can find my profile' })).toHaveAttribute('aria-checked', 'true');
  }
});
