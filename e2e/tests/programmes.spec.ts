import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail } from './helpers.js';

/** Phase 7 pilot step 18 and 19: partners see assigned programmes only; reports show definitions and denominators. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const PROGRAMME = 'Two-Wheeler Livelihoods Bengaluru 2026';

test.describe.serial('partner programmes and reports', () => {
  test('the partner sees its programme with defined figures, beneficiaries without names, and downloads', async ({ page }) => {
    await signInEmail(page, EMAIL.partnerAdminA);
    await page.getByRole('link', { name: /^Programmes/ }).first().click();
    await page.getByRole('link', { name: new RegExp(PROGRAMME) }).click();
    await expect(page.getByRole('heading', { name: PROGRAMME })).toBeVisible();
    await expect(page.getByText('Sponsor: Bright Lubricants CSR Foundation (demo)', { exact: false })).toBeVisible();
    const enrolled = page.locator('li').filter({ hasText: /^Enrolled/ });
    await expect(enrolled).toContainText('of 40');
    await expect(enrolled).toContainText('Candidate-to-batch enrolments');
    await expect(page.locator('li').filter({ hasText: 'Joined (AutoTalent Grid-verified)' })).toContainText('people who completed');
    await expect(page.getByText(/A manually recorded figure, not finance data/)).toBeVisible();

    await page.getByRole('tab', { name: 'beneficiaries' }).click();
    await expect(page.getByRole('columnheader', { name: 'Candidate ID' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toHaveCount(0);
    await expect(page.getByText('Names, mobile numbers and dates of birth are not shared.', { exact: false })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Ravi|Anitha/ })).toHaveCount(0);

    const href = await page.getByRole('link', { name: 'Download (CSV)' }).getAttribute('href');
    const csv = await (await page.request.get(href!)).text();
    expect(csv).toContain('Candidate ID,City,Batch');
    expect(csv).not.toMatch(/Ravi|Anitha|\+91/);
    const report = await (await page.request.get((await page.getByRole('link', { name: 'Outcome report (CSV)' }).getAttribute('href'))!)).text();
    expect(report).toContain('No personal data');
  });

  test('the partner admin adds a work order; another partner cannot see the programme', async ({ page, browser }) => {
    await signInEmail(page, EMAIL.partnerAdminA);
    await page.goto('/partner/programmes');
    await page.getByRole('link', { name: new RegExp(PROGRAMME) }).click();
    await page.getByRole('tab', { name: 'documents' }).click();
    await page.getByRole('button', { name: 'Upload document' }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload programme document' });
    await dialog.getByLabel('File').setInputFiles({ name: 'work-order-2026.pdf', mimeType: 'application/pdf', buffer: PDF });
    await dialog.getByLabel('Type').selectOption('work_order');
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Document uploaded')).toBeVisible();
    await expect(page.getByText(/Work order, .*by Farah Partner A/)).toBeVisible();
    const url = page.url();

    const other = await browser.newContext();
    const b = await other.newPage();
    await signInEmail(b, EMAIL.partnerAdminB);
    await b.goto('/partner/programmes');
    await expect(b.getByText('No programmes')).toBeVisible();
    await b.goto(new URL(url).pathname);
    await expect(b.getByText('Programme not found')).toBeVisible();
    await other.close();
  });

  test('AutoTalent Grid creates a programme for another partner, who then sees it', async ({ page, browser }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.getByRole('link', { name: 'Programmes' }).first().click();
    await page.getByRole('link', { name: 'New programme' }).click();
    await page.getByLabel('Programme name').fill('EV Skills Mysuru 2027');
    await page.getByLabel('Target people').fill('25');
    await page.getByLabel('Start', { exact: true }).fill('2026-11-01');
    await page.getByLabel('End', { exact: true }).fill('2027-06-30');
    await page.getByLabel('Velocity Training Academy (demo)').check();
    await page.getByLabel(/EV Mysuru November 2026/).check();
    await page.getByLabel('Name', { exact: true }).check();
    await page.getByRole('button', { name: 'Create programme' }).click();
    await expect(page.getByText('Record the basis for sharing names, mobile numbers or dates of birth')).toBeVisible();
    await page.getByLabel('Name', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Create programme' }).click();
    await expect(page.getByText('Programme created')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EV Skills Mysuru 2027' })).toBeVisible();

    const other = await browser.newContext();
    const b = await other.newPage();
    await signInEmail(b, EMAIL.partnerAdminB);
    await b.goto('/partner/programmes');
    await expect(b.getByRole('link', { name: /EV Skills Mysuru 2027/ })).toBeVisible();
    await other.close();
  });

  test('AutoTalent Grid filters the cohort report and downloads it', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.goto('/admin/reports');
    await page.getByLabel('Programme').selectOption({ label: PROGRAMME });
    await expect(page.getByText(/Enrolments in 2 batches/)).toBeVisible();
    await expect(page.locator('li').filter({ hasText: /^Passed/ })).toContainText('of');
    const csv = await (await page.request.get((await page.getByRole('link', { name: 'Download CSV' }).getAttribute('href'))!)).text();
    expect(csv).toContain(`Programme,${PROGRAMME}`);
    expect(csv).toContain('No personal data');
  });
});
