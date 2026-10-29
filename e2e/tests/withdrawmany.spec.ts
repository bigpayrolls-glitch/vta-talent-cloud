import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { EMAIL, signInEmail, withDb } from './helpers.js';

/** 29 Oct 2026: ticking several candidates on the roster and withdrawing them together. */
let batchId = '';
test.beforeAll(async () => {
  batchId = await withDb(async (db) => {
    const t = await db.selectFrom('batches').selectAll().where('status', '=', 'planned').orderBy('start_date', 'desc').executeTakeFirstOrThrow();
    const id = randomUUID();
    await db.insertInto('batches').values({ ...t, id, name: 'Withdraw many (e2e)', capacity: 10 }).execute();
    const people = await db.selectFrom('candidate_profiles as cp').innerJoin('users as u', 'u.id', 'cp.user_id').select('u.id').where('u.status', '=', 'active').limit(3).execute();
    for (const p of people) await db.insertInto('enrolments').values({ id: randomUUID(), candidate_id: p.id, batch_id: id, status: 'enrolled' }).execute();
    return id;
  });
});

test('an Admin ticks two candidates and withdraws them together', async ({ page }) => {
  await signInEmail(page, EMAIL.opsAdmin);
  await page.goto(`/admin/batches/${batchId}`);
  const boxes = page.getByRole('checkbox', { name: /^Select / });
  await expect(boxes).toHaveCount(3);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: 'Withdraw 2 selected' }).click();
  const dialog = page.getByRole('dialog', { name: 'Withdraw 2 candidates?' });
  await dialog.getByLabel('Reason for withdrawal').fill('Added by mistake');
  await dialog.getByRole('button', { name: 'Withdraw 2' }).click();
  await expect(page.getByText('2 candidates withdrawn')).toBeVisible();
  await expect(page.getByText(/Withdrawn: Added by mistake/)).toHaveCount(2);
});
