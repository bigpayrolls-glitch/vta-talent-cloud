import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail } from './helpers.js';

/**
 * 5 Nov 2026: an employer could not save a vacancy. A skill longer than 60 characters was refused without any
 * message, so the button seemed to do nothing. Now the problem is named next to the field and above the buttons,
 * and the job can be saved and sent for review in one step.
 */
const JOB = 'Service Advisor – VOC Automotive (e2e)';

test('a job with a too-long skill says what to fix, then saves and goes for review in one step', async ({ page }) => {
  await signInEmail(page, EMAIL.employerAdminA);
  await page.goto('/employer/jobs/new');
  await page.getByLabel('Job title').fill(JOB);
  await page.getByLabel('Skill area').selectOption({ index: 0 });
  await page.getByLabel('Experience needed (years)').fill('2');
  await page.getByLabel('Required skills').fill('Customer handling and voice of customer follow-up calls after every vehicle delivery');
  await page.getByLabel('City', { exact: true }).fill('Bengaluru');
  await page.getByLabel('Openings').fill('1');
  await page.getByLabel('Closing date').fill('2026-12-31');
  await page.getByLabel('Job description').fill('Handle customer feedback calls (VOC), follow up on service complaints and close them with the workshop team.');

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not saved yet. Please correct: Required skills.' })).toBeVisible();
  await expect(page.getByText('Keep each skill under 60 characters. Separate skills with commas.')).toBeVisible();

  await page.getByLabel('Required skills').fill('Customer handling; VOC follow-up calls; Job card basics');
  await page.getByRole('button', { name: 'Save and send for review' }).click();
  await expect(page.getByRole('heading', { name: JOB })).toBeVisible();
  await expect(page.getByText('Waiting for AutoTalent Grid review').first()).toBeVisible();
  // Experience is entered in years and kept as months: 2 years shows as 2 years, and edits show 2 again.
  await expect(page.getByText('2 yrs or more')).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Experience needed (years)')).toHaveValue('2');
  await page.getByRole('link', { name: 'Back to the job' }).click();

  // Close it again so other tests see the same number of active jobs.
  await page.getByRole('button', { name: 'Close job' }).click();
  await expect(page.getByText('Job closed')).toBeVisible();
});
