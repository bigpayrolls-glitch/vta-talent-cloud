import { expect, test } from '@playwright/test';
import { EMAIL, expectNoHorizontalScroll, signInEmail, withDb } from './helpers.js';

/** Training partner Subscription & Billing (29 Oct 2026). Partner B is put on Free for this test, then back. */
const orgId = () => withDb(async (db) => (await db.selectFrom('organisations').select('id').where('legal_name', '=', 'Velocity Training Academy (demo)').executeTakeFirstOrThrow()).id);
let saved: Record<string, unknown> | undefined;
test.beforeAll(async () => {
  const id = await orgId();
  await withDb(async (db) => {
    saved = (await db.selectFrom('employer_subscriptions').selectAll().where('organisation_id', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined;
    await db.deleteFrom('employer_subscriptions').where('organisation_id', '=', id).execute();
  });
});
test.afterAll(async () => {
  const id = await orgId();
  await withDb(async (db) => {
    await db.deleteFrom('employer_subscriptions').where('organisation_id', '=', id).execute();
    if (saved) await db.insertInto('employer_subscriptions').values(saved as never).execute();
  });
});

test('a training partner on Free upgrades to Professional with GST and gets an invoice', async ({ page }) => {
  await signInEmail(page, EMAIL.partnerAdminB);
  await page.getByRole('link', { name: 'Subscription & Billing' }).first().click();
  await expect(page.getByRole('heading', { name: 'Subscription & Billing' })).toBeVisible();
  await expect(page.getByText('Free plan')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan comparison' })).toBeVisible();
  await page.getByRole('button', { name: 'Upgrade now' }).click();
  const order = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Order summary' }) });
  await expect(order.getByText('₹1,769', { exact: true })).toBeVisible(); // ₹1,499 + ₹270 GST (18%)
  await order.getByLabel('UPI').check();
  await order.getByLabel(/I agree to the/).check();
  await order.getByRole('button', { name: /^Proceed to payment/ }).click();
  await expect(page.getByRole('heading', { name: 'Payment successful!' })).toBeVisible();
  await expect(page.getByText('GST', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Subscription & Billing' }).first().click();
  await expect(page.getByRole('button', { name: 'Current plan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await expectNoHorizontalScroll(page);
});
