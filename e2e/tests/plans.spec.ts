import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail } from './helpers.js';

/** Admin > Plans (29 Oct 2026): an Admin changes a plan's price and the employer plans page shows it. */
test('an Admin changes the Starter price; the employer plans page shows the new price', async ({ page, browser }) => {
  await signInEmail(page, EMAIL.opsAdmin);
  await page.goto('/admin/plans');
  const setPrice = async (rupees: string) => {
    await page.getByRole('button', { name: 'Edit Starter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Starter plan' });
    await dialog.getByLabel('Monthly price (₹)').fill(rupees);
    await dialog.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByText('Starter plan saved').last()).toBeVisible();
  };
  await setPrice('1199');
  await expect(page.getByText('₹1,199')).toBeVisible();

  const emp = await (await browser.newContext()).newPage();
  await signInEmail(emp, EMAIL.employerAdminA);
  await emp.goto('/employer/subscription/plans');
  await expect(emp.getByText('₹1,199').first()).toBeVisible();

  await setPrice('999'); // back as it was, for the other tests
});
