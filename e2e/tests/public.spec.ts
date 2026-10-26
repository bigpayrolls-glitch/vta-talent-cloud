import { expect, test } from '@playwright/test';
import { apiLogSize, expectNoHorizontalScroll, ids, latestSignupLink } from './helpers.js';

/** Phase 8: the public home page, certificate check and organisation self-registration. */

test('the public home page offers each kind of user a way in, and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Move to a Job.');
  await expect(page.getByRole('link', { name: 'Create a learner account' })).toHaveAttribute('href', '/register');
  await expect(page.getByRole('link', { name: 'Employers: register your company' })).toHaveAttribute('href', '/join/employer');
  await expect(page.getByRole('link', { name: 'Training partners: register your organisation' })).toHaveAttribute('href', '/join/partner');
  await expect(page.getByRole('link', { name: 'Trainers: sign in' })).toHaveAttribute('href', '/login');
  await expectNoHorizontalScroll(page);
});

for (const [width, height] of [[1536, 1024], [1440, 900], [1366, 768], [1280, 720]] as const) {
  test(`on a ${width}x${height} screen the home page fits without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, client: document.documentElement.clientHeight }));
    expect(scroll).toBeLessThanOrEqual(client);
    await expect(page.getByRole('contentinfo')).toBeInViewport({ ratio: 1 });
  });
}

test('a certificate code typed on the home page opens its check page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Check a certificate' }).first().click();
  const box = page.getByRole('dialog').getByLabel('Certificate code');
  await box.fill('not-a-code');
  await page.getByRole('dialog').getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('32 letters and numbers');
  await box.fill(`https://example.invalid/verify/${ids.credentialRaviCode}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/verify/${ids.credentialRaviCode}$`));
});

test('an employer registers, confirms the email and lands on the company profile to finish it', async ({ page }) => {
  const stamp = Date.now();
  const name = `Neha Test ${stamp}`;
  await page.goto('/join/employer');
  await expect(page.getByRole('heading', { name: 'Register your company' })).toBeVisible();

  await page.getByRole('button', { name: 'Register and confirm my email' }).click();
  await expect(page.getByText('Enter the registered name')).toBeVisible();
  await expect(page.getByText('Choose a sector')).toBeVisible();

  await page.getByLabel('Registered name').fill(`Hosur Motor Care ${stamp}`);
  await page.getByLabel('Sector').selectOption('service_workshop');
  await page.getByLabel('City or town').fill('Hosur');
  await page.getByLabel('Your full name').fill(name);
  await page.getByLabel('Work email').fill(`neha.${stamp}@hosur.example`);
  await page.getByLabel('Mobile number').fill('9876501234');
  await page.getByLabel('I have read the privacy notice').check();
  await page.getByLabel(/I agree to the terms of use/).check();
  const after = apiLogSize();
  await page.getByRole('button', { name: 'Register and confirm my email' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await latestSignupLink(name, after));
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await expect(page.getByText(`Hosur Motor Care ${stamp}`)).toBeVisible();
  await page.getByLabel('New password').fill('A-strong-pass-42');
  await page.getByLabel('Confirm password').fill('A-strong-pass-42');
  await page.getByRole('button', { name: 'Confirm and sign in' }).click();
  await expect(page).toHaveURL(/\/employer\/company$/);
  await expect(page.getByLabel('Registered name')).toHaveValue(`Hosur Motor Care ${stamp}`);
});

test('the partner form asks for the partner type and fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/join/partner');
  await expect(page.getByRole('heading', { name: 'Register a training partner' })).toBeVisible();
  await page.getByRole('button', { name: 'Register and confirm my email' }).click();
  await expect(page.getByText('Choose the partner type')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
