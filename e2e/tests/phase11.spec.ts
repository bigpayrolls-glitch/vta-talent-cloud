import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail, signInPhone, withDb } from './helpers.js';

/** Phase 11: VTA changes a sign-in mobile number; partner admins manage viewers (PA-07). */

test('AutoTalent Grid changes a learner’s mobile number; they sign in with the new one (then it is changed back)', async ({ page, browser }) => {
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
