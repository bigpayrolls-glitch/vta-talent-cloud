import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail, withDb } from './helpers.js';

/** Admin > Courses > Fees and accommodation (29 Oct 2026). */
test.afterAll(async () => {
  await withDb((db) => db.updateTable('courses').set({ status: 'inactive', fee_paise: 0, gst_pct: 0, stay_available: false, stay_fee_paise: null }).where('code', '=', 'ATG-PARTS-1').execute());
});

test('an Admin sets a career course fee and accommodation charge and switches it on', async ({ page, browser }) => {
  await signInEmail(page, EMAIL.opsAdmin);
  await page.goto('/admin/courses');
  await page.getByRole('link', { name: 'Fees and accommodation' }).click();
  await expect(page.getByRole('heading', { name: 'Fees and accommodation' })).toBeVisible();
  const title = 'Parts Manager Beginner: 7 Brands Fast Moving Parts';
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row.getByRole('button', { name: 'Switch on' })).toBeDisabled();
  await row.getByLabel(`Course fee for ${title}`).fill('3000');
  await row.getByLabel(`GST for ${title}`).selectOption('18');
  await row.getByLabel(`Accommodation with food for ${title}`).check();
  await row.getByLabel(`Accommodation with food charge for ${title}`).fill('4500');
  await row.getByLabel(`Meals a day with the stay for ${title}`).selectOption('2');
  await expect(row.getByText('₹3,540')).toBeVisible();
  await row.getByRole('button', { name: 'Switch on' }).click();
  await expect(page.getByText(`${title}: now shown to learners`)).toBeVisible();
  await expect(row.getByText('On', { exact: true })).toBeVisible();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/courses');
  const card = visitor.getByRole('listitem').filter({ hasText: title });
  await expect(card.getByText('₹3,540')).toBeVisible();
  await card.getByRole('link', { name: 'Details' }).click();
  await expect(visitor.getByText('Accommodation with 2 meals a day: ₹4,500')).toBeVisible();
});
