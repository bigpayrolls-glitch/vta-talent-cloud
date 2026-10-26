import { expect, test, type Page } from '@playwright/test';
import { EMAIL, ids, signInEmail, signInPhone } from './helpers.js';

/** Phase 10 security review: the web app's own headers, and that nothing on the key pages breaks its Content Security Policy. */

async function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`));
  });
  return violations;
}

test('the web app sends its security headers', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
});

test('the API sends strict headers and never caches responses', async ({ request }) => {
  const res = await request.get('/api/v1/health/live');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("default-src 'none'");
  expect(h['cache-control']).toBe('no-store');
  expect(h['x-request-id']).toBeTruthy();
});

test('key pages run without breaking the Content Security Policy', async ({ page, browser }) => {
  const violations = await watchCsp(page);
  for (const path of ['/', '/login', '/join/employer', `/verify/${ids.credentialRaviCode}`]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await signInEmail(page, EMAIL.opsAdmin);
  for (const path of ['/admin', '/admin/credentials', '/admin/programmes', '/admin/reports']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }

  const ctx = await browser.newContext();
  const learner = await ctx.newPage();
  const lv = await watchCsp(learner);
  await signInPhone(learner, '9900000211');
  await learner.goto('/learn/certificates');
  await learner.waitForLoadState('networkidle');
  const first = learner.getByRole('link', { name: /2W Service Technician/ }).first();
  if (await first.isVisible()) {
    await first.click();
    await learner.waitForLoadState('networkidle');
    // The QR code is an image made in the browser (a data: URL), which the policy allows.
    await expect(learner.getByRole('img', { name: /QR code/i })).toBeVisible();
  }
  await ctx.close();
  expect([...violations, ...lv]).toEqual([]);
});

test('signed-in pages cannot be framed by another site', async ({ page }) => {
  await page.setContent(`<iframe id="f" src="${test.info().project.use.baseURL}/login"></iframe>`);
  const frame = page.frame({ url: /\/login/ });
  // The browser refuses to render it (frame-ancestors 'none' and X-Frame-Options: DENY), so no sign-in form appears inside.
  const hasForm = frame ? await frame.locator('#email').count().catch(() => 0) : 0;
  expect(hasForm).toBe(0);
});
