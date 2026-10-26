import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail, signInPhone } from './helpers.js';

/** Phase 2 journeys: course → batch → enrolment, as seen by the admin, the partner and the trainer. */
test.describe.serial('training operations', () => {
  test('an admin creates a course with assessment criteria', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.getByRole('link', { name: 'Courses' }).first().click();
    await page.getByRole('button', { name: 'Add course' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add course' });
    await dialog.getByLabel('Course title').fill('EV Battery Specialist');
    await dialog.getByLabel('Code (optional)').fill('EV-BAT-01');
    await dialog.getByLabel('Skill area').selectOption('EV');
    await dialog.getByLabel('Duration').fill('6');
    await dialog.getByLabel('Unit').selectOption('weeks');
    await dialog.getByLabel('Criterion 1', { exact: true }).fill('Battery pack diagnosis');
    await dialog.getByRole('button', { name: 'Add criterion' }).click();
    await dialog.getByLabel('Criterion 2', { exact: true }).fill('High-voltage isolation');
    await dialog.getByRole('button', { name: 'Add course' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('EV Battery Specialist');
    await expect(page.getByRole('row', { name: /Battery pack diagnosis\s*Required\s*50/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /High-voltage isolation\s*10/ })).toBeVisible();
    await expect(page.getByText('At least 75% attendance')).toBeVisible();
  });

  test('an admin creates a batch and enrols candidates', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.goto('/admin/batches');
    await page.getByRole('button', { name: 'Create batch' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create batch' });
    await dialog.getByLabel('Batch name').fill('EV Mysuru Battery January 2027');
    await dialog.getByLabel('Course').selectOption({ label: 'EV Battery Specialist (EV-BAT-01)' });
    await dialog.getByLabel('Centre').selectOption({ label: 'Velocity Mysuru Centre, Mysuru (Velocity Training Academy (demo))' });
    await dialog.getByLabel('Trainer').selectOption({ label: 'Imran Trainer B (EV)' });
    await dialog.getByLabel('Start date').fill('2027-01-11');
    await dialog.getByLabel('End date').fill('2027-02-22');
    await dialog.getByLabel('Capacity').fill('2');
    await dialog.getByRole('button', { name: 'Create batch' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('EV Mysuru Battery January 2027');
    await expect(page.getByText('0 of 2 enrolled')).toBeVisible();

    await page.getByRole('button', { name: 'Enrol candidates' }).click();
    const enrol = page.getByRole('dialog', { name: 'Enrol candidates' });
    await enrol.getByLabel('Search candidates to enrol').fill('Pooja');
    await enrol.getByLabel('Search candidates to enrol').press('Enter');
    await enrol.getByRole('checkbox').first().check();
    await enrol.getByLabel('Search candidates to enrol').fill('Deepa');
    await enrol.getByLabel('Search candidates to enrol').press('Enter');
    await enrol.getByRole('checkbox').first().check();
    await expect(enrol.getByText('2 selected, 2 places left')).toBeVisible();
    await enrol.getByRole('button', { name: 'Enrol 2' }).click();

    await expect(page.getByText('2 of 2 enrolled')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pooja Naik' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enrol candidates' })).toBeDisabled();
    await page.getByRole('button', { name: 'Start batch' }).click();
    await expect(page.getByText('Batch started')).toBeVisible();
  });

  test('the training partner sees the batch read-only, without phone numbers', async ({ page }) => {
    await signInEmail(page, 'partner-b@demo.vta.local');
    await page.getByRole('link', { name: 'Batches' }).first().click();
    await expect(page.getByRole('heading', { name: 'My batches' })).toBeVisible();
    await expect(page.getByText('2W Peenya October 2026')).toHaveCount(0); // another partner's batch
    await page.getByRole('link', { name: /EV Mysuru Battery January 2027/ }).click();
    await expect(page.getByText('Pooja Naik')).toBeVisible();
    await expect(page.getByText('+91 99000')).toHaveCount(0);
    await expect(page.getByText('Contact details are shown to the batch trainer and VTA staff only.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enrol candidates' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel batch' })).toHaveCount(0);
  });

  test('the trainer sees only their own batches, with phone numbers', async ({ page }) => {
    await signInPhone(page, '9900000103');
    await expect(page).toHaveURL(/\/partner$/);
    await page.getByRole('link', { name: 'Batches and rosters' }).click();
    await expect(page.getByRole('link', { name: /EV Mysuru Battery January 2027/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /2W Peenya/ })).toHaveCount(0);
    await page.getByRole('link', { name: /EV Mysuru Battery January 2027/ }).click();
    await expect(page.getByText(/VTA26\d{5}, \+91 99000 00216/)).toBeVisible();
  });
});
