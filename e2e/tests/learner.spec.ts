import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearOtp, latestOtp, signInPhone } from './helpers.js';

/** Phase 5 journeys: self-registration, the consent gate, profile with drafts, documents, results, certificates, privacy. */
const here = path.dirname(fileURLToPath(import.meta.url));
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

test.describe.serial('Learner portal', () => {
  test('a technician creates their own account and fills in the profile, keeping an unsaved draft', async ({ page }) => {
    const phone = '9811122233';
    await clearOtp(phone);
    await page.goto('/login');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    await page.getByLabel('Mobile number').fill(phone);
    await page.getByLabel('Full name').fill('Suresh Babu');
    await page.getByLabel('Date of birth').fill('2001-05-05');
    await page.getByLabel('City or town').fill('Mandya');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Accept the privacy notice to continue')).toBeVisible();
    await page.getByLabel('I have read the privacy notice').check();
    await page.getByLabel('I agree to the terms of use').check();

    const logSize = readFileSync(path.join(here, '../.api.log'), 'utf8').length;
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('6-digit code')).toBeVisible();
    await page.getByLabel('6-digit code').fill(await latestOtp(phone.slice(-2), logSize));
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello, Suresh!');
    await expect(page.getByText(/^VTA\d{7}$/)).toBeVisible();
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
    await expect(page.getByText(/Profile \d+% complete/)).toBeVisible();

    // Start editing, then lose the page: the draft is still there (EE-12).
    await page.goto('/learn/profile');
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await page.getByLabel('Education').fill('ITI Motor Mechanic');
    await page.waitForTimeout(300);
    await page.reload();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page.getByText('Your unsaved changes from last time were kept on this phone.')).toBeVisible();
    await expect(page.getByLabel('Education')).toHaveValue('ITI Motor Mechanic');

    await page.getByRole('button', { name: '2W', exact: false }).first().click();
    await page.getByLabel('Experience (months)').fill('14');
    await page.getByLabel('Languages').fill('Kannada, English');
    await page.getByLabel('Availability').fill('Weekdays');
    await page.getByLabel('Preferred work area').fill('Mandya or Mysuru');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();
    await expect(page.getByText('100%')).toBeVisible();
    await expect(page.getByText('1 yr 2 mo')).toBeVisible();
  });

  test('a candidate added by staff accepts the privacy notice on first sign-in, then sees their certificate and result', async ({ page }) => {
    await signInPhone(page, '9900000211'); // Ravi Kumar
    await expect(page.getByRole('heading', { name: 'Welcome, Ravi' })).toBeVisible();
    await page.getByRole('button', { name: 'Agree and continue' }).click();
    await expect(page.getByText('Tick both boxes to continue.')).toBeVisible();
    await page.getByRole('button', { name: 'Read' }).first().click();
    await expect(page.getByText('What we keep', { exact: true })).toBeVisible();
    await page.getByLabel('I have read the privacy notice').check();
    await page.getByLabel('I agree to the terms of use').check();
    await page.getByRole('button', { name: 'Agree and continue' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello, Ravi!');
    await page.getByRole('link', { name: /2W Service Technician/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ravi Kumar');
    await expect(page.getByText('Valid', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
    await expect(page.getByText('It is not a government, NSDC or ASDC qualification.', { exact: false })).toBeVisible();

    await page.goto('/learn/learning');
    const done = page.locator('li').filter({ hasText: '2W Peenya July 2026' });
    await expect(done.getByText('Assessment: Passed')).toBeVisible();
    await done.getByRole('link', { name: 'View result' }).click();
    await expect(page.getByText('Passed', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Skills assessed' })).toBeVisible();
    await expect(page.getByText(/review/i)).toHaveCount(0); // no reviewer names or internal notes
  });

  test('evidence upload with a choice of who sees it, and removing it again', async ({ page }) => {
    await signInPhone(page, '9900000211');
    await page.goto('/learn/documents');
    await page.getByRole('button', { name: 'Upload' }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload document' });
    await dialog.getByLabel('File', { exact: true }).setInputFiles({ name: 'experience-letter.pdf', mimeType: 'application/pdf', buffer: PDF });
    await dialog.getByLabel('Type').selectOption('experience_letter');
    await dialog.getByLabel('Employers I share my profile with').check();
    await dialog.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Document uploaded. VTA will check it.')).toBeVisible();

    const row = page.locator('li').filter({ hasText: 'experience-letter' });
    await expect(row.getByText('Employers I share my profile with')).toBeVisible();
    await expect(row.getByText('Pending')).toBeVisible();
    await row.getByRole('button', { name: 'Make private' }).click();
    await expect(row.getByText('Only me and VTA')).toBeVisible();
    await row.getByRole('button', { name: /Remove/ }).click();
    await page.getByRole('dialog', { name: 'Remove document?' }).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Document removed')).toBeVisible();
    await expect(page.locator('li').filter({ hasText: 'experience-letter' })).toHaveCount(0);
  });

  test('the learner turns employer search on and off, and every change is listed', async ({ page }) => {
    await signInPhone(page, '9900000211');
    await page.goto('/learn/privacy');
    const sw = page.getByRole('switch', { name: 'Employers can find my profile' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(page.getByText('Now: On, employers can find you')).toBeVisible();
    await sw.click();
    await expect(page.getByText('Now: Off, employers cannot find you')).toBeVisible();
    await expect(page.getByText('turned on')).toBeVisible();
    await expect(page.getByText('turned off')).toBeVisible();
    await expect(page.getByText(/Privacy notice: accepted/)).toBeVisible();
  });

  test('the privacy notice is public and marked as a draft for VTA review', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
    await expect(page.getByText(/Draft for VTA review/)).toBeVisible();
  });
});
