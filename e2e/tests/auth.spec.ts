import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail, signInPhone } from './helpers.js';

test.describe('sign-in and portal routing', () => {
  test('each role lands in its own portal', async ({ page }) => {
    const cases: [string, RegExp, string][] = [
      [EMAIL.superAdmin, /\/admin$/, 'Welcome, Asha!'],
      [EMAIL.employerAdminA, /\/employer$/, 'Hello, Rahul!'],
      [EMAIL.partnerAdminA, /\/partner$/, 'Welcome back, Farah'],
    ];
    for (const [email, url, heading] of cases) {
      await page.context().clearCookies();
      await signInEmail(page, email);
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    }
  });

  test('a learner signs in with a phone code', async ({ page }) => {
    await signInPhone(page, '9900000201');
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello, Venkatesh!');
  });

  test('opening another portal shows Access denied', async ({ page }) => {
    await signInEmail(page, EMAIL.employerAdminA);
    await page.goto('/admin/candidates');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });

  test('a wrong password shows a plain error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL.opsAdmin);
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect');
  });
});
