import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { EMAIL, signInEmail, signInPhone, withDb } from './helpers.js';

/**
 * AutoTalent Grid career journeys (29 Oct 2026): a learner enrols and pays for the course itself;
 * AutoTalent Grid then assigns the batch. Step 1 of the Technician journey is switched on for this test only.
 */
let courseId = '';
test.beforeAll(async () => {
  courseId = await withDb(async (db) => {
    const c = await db.selectFrom('courses').select('id').where('code', '=', 'ATG-TECH-1').executeTakeFirstOrThrow();
    await db.updateTable('courses').set({ fee_paise: 199_900, status: 'active', stay_available: true, stay_fee_paise: null }).where('id', '=', c.id).execute();
    const template = await db.selectFrom('batches').selectAll().where('status', 'in', ['planned', 'active']).orderBy('start_date', 'desc').executeTakeFirstOrThrow();
    await db.insertInto('batches').values({ ...template, id: randomUUID(), name: 'Technician Beginner Peenya (e2e)', course_id: c.id, capacity: 10 }).execute();
    return c.id;
  });
});
test.afterAll(async () => {
  await withDb((db) => db.updateTable('courses').set({ status: 'inactive' }).where('id', '=', courseId).execute());
});

test.describe('career journey courses', () => {
  test('a learner enrols and pays for a journey course; an Admin assigns the batch', async ({ page, browser }) => {
    await signInPhone(page, '9900000201');
    await page.goto('/courses');
    const card = page.getByRole('listitem').filter({ hasText: 'Technician Beginner: 7 Brands 18 Points Check Up' });
    await expect(card.getByText('Technician journey · Step 1 of 4 · Beginner')).toBeVisible();
    await card.getByRole('link', { name: /^Enrol now/ }).click();
    await expect(page).toHaveURL(new RegExp(`/enrol/course/${courseId}$`));
    await page.getByRole('button', { name: 'Pay ₹1,999' }).click();
    await expect(page.getByText('Choose whether you need accommodation with food')).toBeVisible();
    await page.getByLabel('Need accommodation with food').check();
    await expect(page.getByText('To be confirmed')).toBeVisible();
    await page.getByLabel(/I agree to the/).check();
    await page.getByRole('button', { name: 'Pay ₹1,999' }).click();
    await expect(page.getByRole('heading', { name: 'Enrolment successful!' })).toBeVisible();
    await expect(page.getByText('To be assigned by AutoTalent Grid')).toBeVisible();
    await expect(page.getByText('Requested. The charge will be confirmed.')).toBeVisible();
    await page.getByRole('link', { name: 'Go to My Courses' }).click();
    await expect(page.getByText(/AutoTalent Grid will assign your training partner and batch/)).toBeVisible();

    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await signInEmail(admin, EMAIL.opsAdmin);
    await admin.goto('/admin/bookings');
    const row = admin.getByRole('listitem').filter({ hasText: 'Technician Beginner: 7 Brands 18 Points Check Up' }).filter({ hasText: 'Venkatesh' });
    await expect(row.getByText('Needs accommodation with food')).toBeVisible();
    await row.getByRole('button', { name: 'Assign batch' }).click();
    const dialog = admin.getByRole('dialog', { name: 'Assign batch' });
    await dialog.getByLabel(/Technician Beginner Peenya \(e2e\)/).check();
    await dialog.getByRole('button', { name: 'Assign' }).click();
    await expect(admin.getByText(/assigned to the batch/)).toBeVisible();
    await adminCtx.close();

    await page.reload();
    await expect(page.getByText(/AutoTalent Grid will assign your training partner and batch/)).toHaveCount(0);
  });
});
