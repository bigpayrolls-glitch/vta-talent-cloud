import { expect, test } from '@playwright/test';
import { signInPhone } from './helpers.js';

/** A two-wheeler learner sees 2W jobs first under "Recommended for your skills", then other jobs they can still apply to. */
test('jobs matching the learner’s skills come first; others stay open to them', async ({ page }) => {
  await signInPhone(page, '9900000201');
  await page.goto('/learn/jobs');
  await expect(page.getByText(/match your skills \(Two-wheeler\)|matches your skills \(Two-wheeler\)/)).toBeVisible();
  const headings = page.getByRole('heading', { level: 2 });
  await expect(headings.filter({ hasText: 'Recommended for your skills' })).toBeVisible();
  await expect(headings.filter({ hasText: 'Other jobs' })).toBeVisible();
  const first = page.getByRole('listitem').filter({ hasText: 'Two-wheeler service technician' });
  await expect(first.getByText('Matches your skills')).toBeVisible();
  const other = page.getByRole('listitem').filter({ hasText: 'Four-wheeler service technician' });
  await expect(other.getByText('Different skill area')).toBeVisible();
  await other.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Four-wheeler service technician' })).toBeVisible();
  await expect(page.getByText('Different skill area')).toBeVisible();
  await expect(page.getByRole('button', { name: /Apply/ }).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/claude-0/-home-claude/61a888a4-f856-54ce-8a67-03dc4f5a5b5f/scratchpad/r-detail.png' });
  await page.goto('/learn/jobs');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/tmp/claude-0/-home-claude/61a888a4-f856-54ce-8a67-03dc4f5a5b5f/scratchpad/r-list.png', fullPage: true });
});
