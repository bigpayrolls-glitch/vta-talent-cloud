import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { EMAIL, ids, passwordOf, signInEmail, signInPhone } from './helpers.js';

/**
 * Phase 10, requirements §15 Accessibility: "Aim for WCAG 2.2 AA for key journeys".
 * Automated checks (axe-core, WCAG 2.0/2.1/2.2 A and AA rules) on the key screen of every portal.
 * Automated tools find roughly a third of issues; keyboard and screen-reader checks by a person are still needed.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function check(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  // Let entrance animations finish: text that is still fading in would be measured at part opacity.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const problems = r.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`);
  expect.soft(problems, `${name}\n${problems.join('\n')}`).toEqual([]);
}

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  test('public pages', async ({ page }) => {
    for (const path of ['/', '/login', '/register', '/join/employer', '/join/partner', '/forgot-password', '/privacy', '/terms', `/verify/${ids.credentialRaviCode}`]) {
      await page.goto(path);
      await check(page, path);
    }
  });

  test('forms with their error messages showing', async ({ page }) => {
    await page.goto('/join/employer');
    await page.getByRole('button', { name: 'Register and confirm my email' }).click();
    await check(page, 'join with errors');
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await check(page, 'login with errors');
  });

  test('learner portal', async ({ page }) => {
    await signInPhone(page, '9900000201');
    for (const path of ['/learn', '/learn/learning', '/learn/jobs', '/learn/applications', '/learn/certificates', '/learn/profile', '/learn/documents', '/learn/privacy', '/learn/notifications']) {
      await page.goto(path);
      await check(page, path);
    }
  });

  test('employer portal', async ({ page }) => {
    await signInEmail(page, EMAIL.employerAdminA);
    for (const path of ['/employer', '/employer/jobs', '/employer/jobs/new', '/employer/candidates', '/employer/company', '/employer/team', '/employer/account']) {
      await page.goto(path);
      await check(page, path);
    }
  });

  test('training partner and trainer', async ({ page, browser }) => {
    await signInEmail(page, EMAIL.partnerAdminA);
    for (const path of ['/partner', '/partner/batches', '/partner/programmes', '/partner/organisation']) {
      await page.goto(path);
      await check(page, path);
    }
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const t = await ctx.newPage();
    await signInPhone(t, '9900000101');
    for (const path of ['/partner', `/partner/attendance/${ids.batchA}`, '/partner/sync']) {
      await t.goto(path);
      await check(t, `trainer ${path}`);
    }
    await ctx.close();
  });

  test('admin portal', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    for (const path of ['/admin', '/admin/candidates', '/admin/batches', '/admin/assessments', '/admin/jobs', '/admin/organisations', '/admin/programmes', '/admin/reports', '/admin/users', '/admin/audit']) {
      await page.goto(path);
      await check(page, path);
    }
  });
});

test.describe('accessibility: dialogs, menus and keyboard', () => {
  test('open dialogs and menus pass the same checks', async ({ page, browser }) => {
    await signInPhone(page, '9900000201');
    await page.goto('/learn/privacy');
    await page.getByRole('button', { name: 'Ask to close my account' }).click();
    await check(page, 'close-account dialog');
    await page.getByRole('button', { name: 'Keep my account' }).click();
    await page.getByRole('button', { name: /Account menu/ }).click();
    await check(page, 'account menu');

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await signInEmail(p, EMAIL.opsAdmin);
    await p.getByRole('button', { name: 'Open menu' }).click();
    await check(p, 'mobile menu drawer');
    await ctx.close();
  });

  test('signing in works with the keyboard alone, and focus is visible', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab'); // first stop: the mobile wordmark is hidden on desktop, so the method tabs come first
    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
      order.push(await page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el?.getAttribute('aria-label') || el?.id || el?.textContent?.trim() || ''; }));
      await page.keyboard.press('Tab');
    }
    expect(order).toEqual(expect.arrayContaining(['email', 'password', 'Sign in']));
    expect(order.indexOf('email')).toBeLessThan(order.indexOf('password'));
    expect(order.indexOf('password')).toBeLessThan(order.indexOf('Sign in'));

    await page.locator('#email').focus();
    const outline = await page.locator('#email').evaluate((el) => {
      const s = getComputedStyle(el);
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
    });
    expect(outline, 'focused input shows a focus indicator').toBe(true);

    await page.keyboard.type(EMAIL.centreAdmin);
    await page.keyboard.press('Tab');
    await page.keyboard.type(passwordOf(EMAIL.centreAdmin));
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/\/login$/);
    // "Skip to content" is the first thing a keyboard user reaches in a portal.
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});
