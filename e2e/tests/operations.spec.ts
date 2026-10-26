import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail, signInPhone } from './helpers.js';

/**
 * Phase 3 journey: the trainer takes attendance and assesses a candidate, a VTA reviewer approves,
 * the batch is completed, a certificate is issued, and its QR check page confirms it.
 */
test.describe.serial('training operations: attendance to certificate', () => {
  test('the trainer takes attendance from the Today list', async ({ page }) => {
    await signInPhone(page, '9900000101');
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    const today = page.locator('li').filter({ hasText: '2W Peenya October 2026' });
    await today.getByRole('link', { name: 'Take attendance' }).click();
    await expect(page.getByRole('tab', { name: 'Attendance', selected: true })).toBeVisible();
    await expect(page.getByLabel('Session date')).toHaveValue('2026-10-26');

    await page.getByRole('group', { name: 'Attendance for Mohammed Shafi' }).getByRole('button', { name: 'Absent' }).click();
    await page.getByRole('button', { name: 'Mark the rest present' }).click();
    await expect(page.getByRole('group', { name: 'Attendance for Mohammed Shafi' }).getByRole('button', { name: 'Absent' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('4 changes not saved')).toBeVisible();
    await page.getByRole('button', { name: 'Save attendance' }).click();
    await expect(page.getByText(/Attendance saved for .*26 Oct,? 2026 \(4 changes\)/)).toBeVisible();
    await expect(page.getByText('All saved')).toBeVisible();

    await page.getByRole('tab', { name: /Roster/ }).click();
    await expect(page.getByRole('tab', { name: /1 at risk/ })).toBeVisible();
    await expect(page.locator('li').filter({ hasText: 'Mohammed Shafi' }).getByText(/% below needed/)).toBeVisible();
  });

  test('the trainer assesses a candidate and submits for review', async ({ page }) => {
    await signInPhone(page, '9900000101');
    await page.goto('/partner/batches');
    await page.getByRole('link', { name: /2W Peenya October 2026/ }).click();
    await page.getByRole('tab', { name: 'Assessments' }).click();
    await page.locator('li').filter({ hasText: 'Venkatesh Learner' }).getByRole('button', { name: 'Assess' }).click();

    const dialog = page.getByRole('dialog', { name: 'Assess: Venkatesh Learner' });
    const marks: [string, string][] = [
      ['Engine servicing', '24'],
      ['Electrical diagnosis', '21'],
      ['Brakes and suspension', '15'],
      ['Workshop safety', '17'],
    ];
    for (const [label, score] of marks) {
      await dialog.getByLabel(`Result for ${label}`).selectOption('pass');
      await dialog.getByLabel(new RegExp(`^Marks for ${label}`)).fill(score);
    }
    await expect(dialog.getByText('77 of 100 marks')).toBeVisible();
    await expect(dialog.getByText('Would be: Pass')).toBeVisible();
    await dialog.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.getByText('Submitted for review (pass)')).toBeVisible();
    await expect(page.locator('li').filter({ hasText: 'Venkatesh Learner' }).getByText('Awaiting review')).toBeVisible();
  });

  test('a VTA reviewer approves from the review queue', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.getByRole('link', { name: 'Assessment review' }).click();
    await page.getByRole('link', { name: /Venkatesh Learner/ }).click();
    await expect(page.getByRole('tab', { name: 'Assessments', selected: true })).toBeVisible();
    await page.locator('li').filter({ hasText: 'Venkatesh Learner' }).getByRole('button', { name: 'Review' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assessment: Venkatesh Learner' });
    await expect(dialog.getByText('Submitted by Prakash Trainer.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Result approved and released')).toBeVisible();
    await expect(page.locator('li').filter({ hasText: 'Venkatesh Learner' }).getByText('Approved')).toBeVisible();
  });

  test('completing the batch and issuing certificates', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.goto('/admin/batches');
    await page.getByRole('link', { name: /2W Peenya October 2026/ }).click();
    await page.getByRole('button', { name: 'Mark completed' }).click();
    await expect(page.getByText(/Batch completed: 3 completed, 1 below the attendance needed/)).toBeVisible();

    await page.getByRole('button', { name: 'Issue certificates' }).click();
    const dialog = page.getByRole('dialog', { name: 'Certificates' });
    await expect(dialog.getByText('1 issued: Venkatesh Learner.')).toBeVisible();
    await expect(dialog.locator('li').filter({ hasText: 'Mohammed Shafi' })).toContainText('Did not meet the attendance needed to complete');
    await expect(dialog.locator('li').filter({ hasText: 'Ravi Kumar' })).toContainText('No assessment recorded');
    await dialog.getByRole('button', { name: 'Done' }).click();

    await page.locator('li').filter({ hasText: 'Venkatesh Learner' }).getByRole('link', { name: 'Certificate' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Venkatesh Learner');
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    await expect(page.getByText('It is not a government, NSDC or ASDC qualification.', { exact: false })).toBeVisible();

    const pagePromise = page.context().waitForEvent('page');
    await page.getByRole('link', { name: 'Open check page' }).click();
    const check = await pagePromise;
    await expect(check.getByText('Valid certificate')).toBeVisible();
    await expect(check.getByText('Venkatesh Learner')).toBeVisible();
    await expect(check.getByText('2W Service Technician')).toBeVisible();
    await expect(check.getByText(/\+91|VTA26/)).toHaveCount(0);
  });

  test('a revoked certificate shows as revoked on its check page, without signing in', async ({ page, browser }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.goto('/admin/credentials?q=Anitha');
    await expect(page.getByText('No certificates yet')).toBeVisible(); // Anitha's is not issued yet
    await page.goto('/admin/batches');
    await page.getByRole('link', { name: /2W Peenya July 2026/ }).click();
    await page.getByRole('button', { name: 'Issue certificates' }).click();
    await page.getByRole('dialog', { name: 'Certificates' }).getByRole('button', { name: 'Done' }).click();
    await page.goto('/admin/credentials?q=Anitha');
    await page.getByRole('link', { name: /Anitha Gowda/ }).click();
    const verifyPath = await page.getByRole('link', { name: 'Open check page' }).getAttribute('href');
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByLabel('Why is it revoked?').fill('Issued to the wrong batch');
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Certificate revoked')).toBeVisible();

    const anonymous = await browser.newContext();
    const pub = await anonymous.newPage();
    await pub.goto(`http://localhost:5174${verifyPath}`);
    await expect(pub.getByText('This certificate has been revoked')).toBeVisible();
    await pub.goto('http://localhost:5174/verify/aaaabbbbccccddddeeeeffffgggghhhh');
    await expect(pub.getByText('No certificate found')).toBeVisible();
    await anonymous.close();
  });
});
