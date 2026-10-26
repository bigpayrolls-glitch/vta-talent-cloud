import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail } from './helpers.js';

const CSV = [
  'name,phone,date_of_birth,city,skill_areas,experience_months',
  'Ramesh Kulkarni,9900000701,1999-09-09,Belagavi,2W;4W,18',
  'Too Young,9900000702,2014-01-01,Belagavi,2W,0',
  'Ravi Kumar,9900000703,2002-08-01,Bengaluru,2W,0',
].join('\n');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 0x20), Buffer.from('\n%%EOF')]);

test.describe.serial('candidates', () => {
  test('CSV import: check first, then import valid rows only', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.goto('/admin/candidates');
    await page.getByRole('link', { name: 'Import CSV' }).click();
    await page.locator('#csv-file').setInputFiles({ name: 'batch-oct.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });

    await expect(page.getByRole('row', { name: /Ramesh Kulkarni.*Ready/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Too Young.*Will be skipped.*18 or older/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Ravi Kumar.*Possible duplicate/ })).toBeVisible();

    await page.getByRole('button', { name: 'Import 2 candidates' }).click();
    await expect(page.getByText('2 imported')).toBeVisible();
    await page.getByRole('link', { name: 'Review candidates' }).click();
    await expect(page.getByRole('link', { name: 'Ramesh Kulkarni' })).toBeVisible();
  });

  test('verify a candidate, upload a certificate and download it with a short-lived link', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.goto('/admin/candidates?q=Ramesh');
    await page.getByRole('link', { name: 'Ramesh Kulkarni' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ramesh Kulkarni');

    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('Candidate verified')).toBeVisible();
    await expect(page.getByText(/Verified \d+ \w+ \d{4} by Vikram Operations/)).toBeVisible();

    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload document' });
    await dialog.getByLabel('File').setInputFiles({ name: 'iti-certificate.pdf', mimeType: 'application/pdf', buffer: PDF });
    await dialog.getByLabel('Title').fill('ITI certificate');
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Document uploaded')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download ITI certificate' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('iti-certificate.pdf');
    expect(download.url()).toMatch(/\/api\/v1\/files\/[\w-]+\/content\?exp=\d+&sig=/);
  });

  test('a possible duplicate must be reviewed before verifying', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.goto('/admin/candidates?duplicates=true');
    await page.getByRole('row').filter({ hasText: 'Ravi Kumar' }).first().getByRole('link').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Possible duplicate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toBeDisabled();
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByLabel('Why is this profile rejected?').fill('Same person as the existing profile');
    await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('Candidate rejected')).toBeVisible();
    await expect(page.getByText('Reason: Same person as the existing profile')).toBeVisible();
  });

  test('a centre admin sees only candidates at their centre and cannot add new ones', async ({ page }) => {
    await signInEmail(page, EMAIL.centreAdmin);
    await page.getByRole('link', { name: 'Candidates' }).first().click();
    await expect(page.getByRole('link', { name: 'Ramesh Kulkarni' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add candidate' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import CSV' })).toHaveCount(0);
  });
});
