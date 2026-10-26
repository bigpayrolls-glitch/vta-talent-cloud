import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, ids, signInPhone, withDb } from './helpers.js';

/**
 * Phase 4 (TR-04, TR-08, TR-09, PWA): the pilot step "trainer records attendance, including one offline session,
 * and syncs it later", on the built app with its service worker, at phone size.
 */
test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

const DATE = '2026-10-22'; // no attendance in the demo data for this date
const savedMarks = (date: string) =>
  withDb((db) =>
    db
      .selectFrom('attendance_records as r')
      .innerJoin('attendance_sessions as s', 's.id', 'r.session_id')
      .innerJoin('users as u', 'u.id', 'r.candidate_id')
      .select(['u.name', 'r.status', 'r.client_captured_at'])
      .where('s.batch_id', '=', ids.batchA!)
      .where('s.session_date', '=', date)
      .orderBy('u.name')
      .execute(),
  );

/** Signs in, waits until the service worker controls the page, and lets the roster download to the phone. */
async function readyForOffline(page: Page) {
  await signInPhone(page, '9900000101');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('li').filter({ hasText: '2W Peenya October 2026' }).getByRole('link', { name: 'Take attendance' })).toBeVisible();
}

const header = (page: Page) => page.getByRole('banner');

test.describe.serial('offline attendance', () => {
  test('the app is installable: manifest, icons and service worker', async ({ page, request }) => {
    await page.goto('/login');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await request.get(href!)).json();
    expect(manifest).toMatchObject({ name: 'AutoTalent Grid', short_name: 'AutoTalent', display: 'standalone', start_url: '/login', theme_color: '#B5121B' });
    for (const icon of manifest.icons) expect((await request.get(icon.src)).headers()['content-type']).toBe('image/png');
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    const sw = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL);
    expect(sw).toMatch(/\/sw\.js$/);
  });

  test('a trainer takes attendance offline, and it syncs when the connection returns', async ({ page, context }) => {
    await readyForOffline(page);
    await expect(header(page).getByRole('link', { name: /Sync status: Synced/ })).toBeVisible();

    // Connection lost. The app still opens, from the phone.
    await context.setOffline(true);
    await page.reload();
    await expect(header(page).getByRole('link', { name: /Sync status: Offline/ })).toBeVisible();
    await page.locator('li').filter({ hasText: '2W Peenya October 2026' }).getByRole('link', { name: 'Take attendance' }).click();
    await expect(page.getByText('You are offline. Marks are saved on this phone')).toBeVisible();

    await page.getByLabel('Session date').fill(DATE);
    await page.getByRole('group', { name: 'Attendance for Venkatesh Learner' }).getByRole('button', { name: 'Absent' }).click();
    await page.getByRole('button', { name: 'Mark the rest present' }).click();
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(page.getByText('Saved on this phone. 4 changes will sync when you are back online.')).toBeVisible();
    await expect(page.getByText('Saved on this phone, 4 waiting to sync')).toBeVisible();
    await expect(page.locator('li').filter({ hasText: 'Venkatesh Learner' }).getByText('Waiting to sync')).toBeVisible();
    await expect(header(page).getByRole('link', { name: /Offline, 4 waiting/ })).toBeVisible();
    // The busiest header (sync status, notifications, account) still fits a phone.
    await expectNoHorizontalScroll(page);

    // Still offline: the queue survives closing and reopening the app.
    await page.reload();
    await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('link', { name: 'Sync' }).click();
    await expect(page.getByRole('heading', { name: 'Waiting to sync (4)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    expect(await savedMarks(DATE)).toEqual([]); // nothing reached the server yet

    // Back online: it syncs on its own.
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Waiting to sync (0)' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Nothing waiting.')).toBeVisible();
    await expect(header(page).getByRole('link', { name: /Sync status: Synced/ })).toBeVisible();

    const marks = await savedMarks(DATE);
    expect(marks.map((m) => [m.name, m.status])).toEqual([
      ['Anitha Gowda', 'present'],
      ['Mohammed Shafi', 'present'],
      ['Ravi Kumar', 'present'],
      ['Venkatesh Learner', 'absent'],
    ]);
    // Saved with the time it was taken on the phone, not the time it arrived.
    expect(marks.every((m) => m.client_captured_at)).toBe(true);
  });

  test('a conflict is shown with both marks, and the trainer chooses', async ({ page, context }) => {
    await readyForOffline(page);
    await context.setOffline(true);
    await page.goto(`/partner/attendance/${ids.batchA}`);
    await page.getByLabel('Session date').fill(DATE);
    await page.getByRole('group', { name: 'Attendance for Ravi Kumar' }).getByRole('button', { name: 'Late' }).click();
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(page.getByText('Saved on this phone. 1 change will sync')).toBeVisible();

    // Meanwhile a different mark for Ravi reaches the server, after the phone's one was taken.
    await withDb(async (db) => {
      const s = await db.selectFrom('attendance_sessions').select('id').where('batch_id', '=', ids.batchA!).where('session_date', '=', DATE).executeTakeFirstOrThrow();
      await db
        .updateTable('attendance_records')
        .set({ status: 'excused', client_captured_at: new Date(Date.now() + 60_000) })
        .where('session_id', '=', s.id)
        .where('candidate_id', '=', ids.cand1!)
        .execute();
    });

    await context.setOffline(false);
    await expect(header(page).getByRole('link', { name: /Sync problem/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('li').filter({ hasText: 'Ravi Kumar' }).getByRole('link', { name: 'Needs your choice' })).toBeVisible();

    // Signing out now would lose it, so the app asks first.
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const guard = page.getByRole('dialog', { name: 'Changes not synced' });
    await expect(guard).toContainText('1 attendance change on this phone has not reached the server');
    await guard.getByRole('button', { name: 'Cancel' }).click();

    await header(page).getByRole('link', { name: /Sync problem/ }).click();
    await expect(page.getByRole('heading', { name: 'Needs your choice (1)' })).toBeVisible();
    const row = page.locator('li').filter({ hasText: 'Ravi Kumar' });
    await expect(row.getByText('Your mark')).toBeVisible();
    await expect(row.getByText('Late')).toBeVisible();
    await expect(row.getByText('Excused')).toBeVisible();
    await row.getByRole('button', { name: 'Use my mark' }).click();
    await expect(page.getByText('Nothing waiting.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Needs your choice/ })).toHaveCount(0);
    // The screen can clear a moment before the server's write is visible here, so wait for it.
    await expect.poll(async () => (await savedMarks(DATE)).find((m) => m.name === 'Ravi Kumar')?.status, { timeout: 10_000 }).toBe('late');
  });

  test('signing out needs a connection, then deletes the offline data from the phone', async ({ page, context }) => {
    await readyForOffline(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog', { name: 'You are offline' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'OK' }).click();

    await context.setOffline(false);
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    const left = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const req = indexedDB.open('vta-offline');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const d = req.result;
            const names = ['kv', 'batches', 'ops'].filter((n) => d.objectStoreNames.contains(n));
            if (!names.length) return resolve(0);
            const tx = d.transaction(names);
            let total = 0;
            let done = 0;
            for (const n of names) {
              const c = tx.objectStore(n).count();
              c.onsuccess = () => {
                total += c.result;
                if (++done === names.length) resolve(total);
              };
            }
          };
        }),
    );
    expect(left).toBe(0);
  });
});
