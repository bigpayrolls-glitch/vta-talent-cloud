import { expect, test } from '@playwright/test';
import { EMAIL, expectNoHorizontalScroll, signInEmail, signInPhone } from './helpers.js';

/** Phone-sized checks (Pixel 7): bottom navigation, no sideways scrolling on key screens. */
test.describe('on a phone', () => {
  test('admin screens fit the screen and use the bottom bar', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    const bar = page.getByRole('navigation', { name: 'Quick navigation' });
    await expect(bar).toBeVisible();
    for (const name of ['Dashboard', 'Candidates', 'Batches', 'Courses', 'Users']) await expect(bar.getByRole('link', { name })).toBeVisible();
    for (const path of ['/admin', '/admin/candidates', '/admin/batches', '/admin/courses', '/admin/trainers', `/admin/batches?status=active`]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
    }
    await bar.getByRole('link', { name: 'Batches' }).click();
    await expect(page).toHaveURL(/\/admin\/batches$/);
  });

  test('the full menu opens from the header', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await menu.getByRole('link', { name: 'Trainers' }).click();
    await expect(page.getByRole('heading', { name: 'Trainers' })).toBeVisible();
  });

  test('a trainer’s batch and roster fit a phone screen', async ({ page }) => {
    await signInPhone(page, '9900000101');
    await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('link', { name: 'Batches' }).click();
    await page.getByRole('link', { name: /2W Peenya October 2026/ }).click();
    await expect(page.getByText('Venkatesh Learner')).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Attendance on a phone (marking buttons while the batch runs, a read-only view after) must fit without sideways scrolling.
    await page.getByRole('tab', { name: 'Attendance' }).click();
    await expect(page.getByLabel('Session date')).toBeVisible();
    await expect(page.getByText('Venkatesh Learner')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('tab', { name: 'Assessments' }).click();
    await expect(page.getByText('Venkatesh Learner')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('a trainer’s Today list, attendance screen and Sync status fit a phone', async ({ page }) => {
    await signInPhone(page, '9900000101');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('link', { name: 'Sync' }).click();
    await expect(page.getByRole('heading', { name: 'Sync status' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const take = page.getByRole('link', { name: 'Take attendance' });
    await page.goto('/partner');
    if (await take.count()) {
      await take.first().click();
      await expect(page.getByLabel('Session date')).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });

  test('the public certificate check page fits a phone', async ({ page }) => {
    await page.goto('/verify/aaaabbbbccccddddeeeeffffgggghhhh');
    await expect(page.getByText('No certificate found')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
