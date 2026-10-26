import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail, signInPhone, withDb } from './helpers.js';

/** Phase 11: VTA changes a sign-in mobile number; partner admins manage viewers (PA-07). */

test('VTA changes a learner’s mobile number; they sign in with the new one (then it is changed back)', async ({ page, browser }) => {
  const anitha = await withDb((db) => db.selectFrom('users').select('id').where('phone', '=', '+919900000212').executeTakeFirstOrThrow());
  await signInEmail(page, EMAIL.opsAdmin);
  await page.goto(`/admin/candidates/${anitha.id}`);
  await page.getByRole('button', { name: 'Change mobile number' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change mobile number' });
  await dialog.getByLabel('New mobile number').fill('9845077777');
  await dialog.getByRole('button', { name: 'Change number' }).click();
  await expect(dialog.getByText('Say how you checked who they are')).toBeVisible();
  await dialog.getByLabel('How you checked who they are').fill('Checked Aadhaar card at the centre');
  await dialog.getByRole('button', { name: 'Change number' }).click();
  await expect(page.getByText('now signs in with +91 98450 77777')).toBeVisible();

  const ctx = await browser.newContext();
  const learner = await ctx.newPage();
  await signInPhone(learner, '9845077777');
  await expect(learner).toHaveURL(/\/learn/);
  await ctx.close();

  // Put it back for the other tests.
  await page.reload();
  await page.getByRole('button', { name: 'Change mobile number' }).click();
  await page.getByLabel('New mobile number').fill('9900000212');
  await page.getByLabel('How you checked who they are').fill('Restoring the demo number');
  await page.getByRole('button', { name: 'Change number' }).click();
  await expect(page.getByText('now signs in with +91 99000 00212')).toBeVisible();
});

test('a partner admin invites a viewer and removes them; the page passes accessibility checks', async ({ page }) => {
  await signInEmail(page, EMAIL.partnerAdminA);
  await page.getByRole('link', { name: 'Team' }).first().click();
  await expect(page).toHaveURL(/\/partner\/team$/);
  await expect(page.getByText('Viewers can see your programmes')).toBeVisible();
  await page.getByRole('button', { name: 'Invite viewer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite viewer' });
  await dialog.getByLabel('Name').fill('Kavya Viewer');
  await dialog.getByLabel('Email').fill(`kavya.${Date.now()}@skillbridge.example`);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog.getByText(/invitation link to pass on/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  const row = page.locator('li').filter({ hasText: 'Kavya Viewer' });
  await expect(row.getByText(/^Viewer,/)).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);

  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog', { name: 'Remove from team?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Kavya Viewer no longer has access')).toBeVisible();
  await expect(row).toHaveCount(0);
});

test('a viewer does not get the Team page', async ({ page }) => {
  await signInEmail(page, EMAIL.partnerViewerA);
  await expect(page.getByRole('navigation', { name: 'Training Partner Portal' }).getByRole('link', { name: 'Team' })).toHaveCount(0);
});
