import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectNoHorizontalScroll, signInPhone } from './helpers.js';

/** Site languages (29 Oct 2026): the menu switches the text, is remembered, and the pages still fit a phone. */
const locales = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/src/locales');
const dict = (code: string) => JSON.parse(readFileSync(path.join(locales, `${code}.json`), 'utf8')) as Record<string, string>;

test.describe('site languages', () => {
  test('a visitor switches the public site to Hindi, it is remembered, and back to English', async ({ page }) => {
    const hi = dict('hi');
    await page.goto('/');
    await page.locator('select[name="language"]').selectOption('hi');
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByRole('link', { name: hi['Sign in'] })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: hi['Sign in'] })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 800 });
    await expectNoHorizontalScroll(page);
    await page.goto('/courses');
    await expectNoHorizontalScroll(page);
    // Tamil and Malayalam words are long: buttons wrap instead of running off the screen.
    for (const code of ['ta', 'ml']) {
      await page.locator('select[name="language"]').selectOption(code);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
      for (const b of await page.locator('main a.btn-primary, main a.btn-secondary').all()) {
        const box = await b.boundingBox();
        if (box) expect(box.x + box.width, 'button fits the screen').toBeLessThanOrEqual(375);
      }
    }
    await page.locator('select[name="language"]').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('a learner switches the portal to Kannada and the screens still fit a phone', async ({ page }) => {
    const kn = dict('kn');
    await signInPhone(page, '9900000201');
    await page.locator('select[name="language"]').selectOption('kn');
    await expect(page.getByRole('navigation', { name: kn['Learner Portal'] }).getByRole('link', { name: kn['Jobs'] })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 800 });
    for (const p of ['/learn', '/learn/jobs', '/learn/learning', '/learn/profile']) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
    }
    await page.locator('select[name="language"]').selectOption('en');
  });
});
