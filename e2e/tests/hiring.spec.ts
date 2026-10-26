import { expect, test } from '@playwright/test';
import { EMAIL, signInEmail, signInPhone } from './helpers.js';

/**
 * Phase 6 pilot steps 16 and 17: an employer publishes a vacancy (after VTA review), a learner shares their profile
 * and applies, the employer shortlists, interviews and records the joining, and VTA confirms the outcome.
 */
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const JOB = 'Two-wheeler workshop technician (e2e)';

test.describe.serial('hiring: vacancy to verified joining', () => {
  test('a recruiter posts a job and sends it to AutoTalent Grid; AutoTalent Grid publishes it', async ({ page, browser }) => {
    await signInEmail(page, EMAIL.recruiterA);
    await page.getByRole('link', { name: 'Post a job' }).first().click();
    await page.getByLabel('Job title').fill(JOB);
    await page.getByLabel('Experience needed (months)').fill('6');
    await page.getByLabel('Required skills').fill('Engine servicing, Brakes');
    await page.getByLabel('City', { exact: true }).fill('Bengaluru');
    await page.getByLabel('Salary from (₹ a month, optional)').fill('15000');
    await page.getByLabel('Salary to (₹ a month, optional)').fill('12000');
    await page.getByLabel('Openings').fill('2');
    await page.getByLabel('Closing date').fill('2026-12-20');
    await page.getByLabel('Job description').fill('Service and repair two-wheelers in our Peenya workshop, following the checklist.');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('The maximum must be at least the minimum')).toBeVisible();
    await page.getByLabel('Salary to (₹ a month, optional)').fill('20000');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('heading', { name: JOB })).toBeVisible();
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByText('Waiting for AutoTalent Grid review').first()).toBeVisible();

    const admin = await browser.newContext();
    const a = await admin.newPage();
    await signInEmail(a, EMAIL.opsAdmin);
    await a.getByRole('link', { name: /jobs? to review/ }).click();
    await a.getByRole('link', { name: new RegExp(JOB.replace(/[()]/g, '\\$&')) }).click();
    await a.getByRole('button', { name: 'Publish' }).click();
    await expect(a.getByText('Job published')).toBeVisible();
    await admin.close();
  });

  test('a learner finds the job, sees what will be shared, and applies', async ({ page }) => {
    await signInPhone(page, '9900000201'); // Venkatesh
    await page.getByRole('link', { name: 'Jobs', exact: true }).first().click();
    await page.getByRole('link', { name: new RegExp(JOB.replace(/[()]/g, '\\$&')) }).click();
    await expect(page.getByText('₹15,000 to ₹20,000 a month')).toBeVisible();
    await page.getByRole('button', { name: 'Apply' }).click();
    const dialog = page.getByRole('dialog', { name: /Apply:/ });
    await expect(dialog.getByText('Mobile number')).toBeVisible();
    await dialog.getByRole('button', { name: 'Send application' }).click();
    await expect(dialog.getByText('Confirm that your profile may be shared with this employer')).toBeVisible();
    await dialog.getByLabel(/Share my profile with Sunrise/).check();
    await dialog.getByRole('button', { name: 'Send application' }).click();
    await expect(page.getByText('Applied to Sunrise Two-Wheeler Service (demo)')).toBeVisible();
    await expect(page.getByRole('heading', { name: JOB })).toBeVisible();
    await expect(page.getByText('Applied', { exact: true }).first()).toBeVisible();
  });

  test('the recruiter shortlists, interviews, offers and records the joining', async ({ page }) => {
    await signInEmail(page, EMAIL.recruiterA);
    await page.goto('/employer/jobs');
    await page.getByRole('link', { name: new RegExp(JOB.replace(/[()]/g, '\\$&')) }).click();
    await page.getByRole('link', { name: /Venkatesh Learner/ }).click();
    await expect(page.getByRole('link', { name: '+91 99000 00201' })).toBeVisible();
    await expect(page.getByText('Opening this page is logged.', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Shortlist' }).click();
    await expect(page.getByText('Moved to Shortlisted')).toBeVisible();
    await page.getByRole('button', { name: 'Schedule' }).click();
    const iv = page.getByRole('dialog', { name: 'Schedule interview' });
    await iv.getByLabel('Date and time').fill('2026-10-28T10:30');
    await iv.getByLabel('Where (optional)').fill('Peenya workshop');
    await iv.getByLabel('Internal notes (your team only)').fill('Good on brakes; check electrical basics');
    await iv.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Interview scheduled')).toBeVisible();
    await expect(page.getByText('Good on brakes; check electrical basics')).toBeVisible();

    await page.getByRole('button', { name: 'Record offer' }).click();
    await expect(page.getByText('Moved to Offer made')).toBeVisible();
    await page.getByRole('button', { name: 'Record joining' }).click();
    const join = page.getByRole('dialog', { name: 'Record joining' });
    await join.getByLabel('Joining date').fill('2026-10-26');
    await join.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Joined on 26 Oct 2026')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Joined' }).first()).toBeVisible();
  });

  test('the learner sees the progress and interview time, but not the employer’s notes', async ({ page }) => {
    await signInPhone(page, '9900000201');
    await page.goto('/learn/applications');
    await page.getByRole('link', { name: new RegExp(JOB.replace(/[()]/g, '\\$&')) }).click();
    await expect(page.getByText(/The employer recorded that you joined on 26 Oct 2026/)).toBeVisible();
    await expect(page.getByText('In person, Peenya workshop')).toBeVisible();
    await expect(page.getByText(/Good on brakes/)).toHaveCount(0);
  });

  test('AutoTalent Grid confirms the recorded joining', async ({ page }) => {
    await signInEmail(page, EMAIL.opsAdmin);
    await page.getByRole('link', { name: /hiring outcomes? to confirm/ }).click();
    const row = page.locator('li').filter({ hasText: 'Venkatesh Learner' });
    await row.getByRole('button', { name: 'Review' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/How was it checked/).fill('Confirmed by phone with employer and candidate');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Outcome confirmed')).toBeVisible();
  });

  test('the employer searches candidates (masked) and invites one to apply', async ({ page, browser }) => {
    await signInEmail(page, EMAIL.recruiterA);
    await page.getByRole('navigation', { name: 'Employer Portal' }).getByRole('link', { name: 'Candidates' }).click();
    await page.getByLabel('Skill area').selectOption('2W');
    await page.getByRole('link', { name: /Venkatesh L\./ }).click();
    await expect(page.getByText('Contact: shared when they apply to one of your jobs.')).toBeVisible();
    await expect(page.getByText(/\+91|Learner/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Invite to apply' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite to apply' });
    await dialog.getByLabel('Job').selectOption({ label: 'Two-wheeler service technician' });
    await dialog.getByLabel('Message (optional)').fill('We liked your profile');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Venkatesh L. was invited.', { exact: false })).toBeVisible();

    const learner = await browser.newContext();
    const l = await learner.newPage();
    await signInPhone(l, '9900000201');
    await l.goto('/learn/jobs');
    await expect(l.getByText('Sunrise Two-Wheeler Service (demo) invited you to apply: Two-wheeler service technician')).toBeVisible();
    await learner.close();
  });

  test('a new employer completes its company profile and sends it to AutoTalent Grid, which checks the documents and verifies it', async ({ page, browser }) => {
    await signInEmail(page, EMAIL.employerAdminPending);
    await expect(page.getByText(/Complete your company profile and send it to AutoTalent Grid/)).toBeVisible();
    await page.getByRole('link', { name: 'Company profile' }).click();
    await page.getByLabel('Contact person').fill('Meera Employer Pending');
    await page.getByLabel('Contact mobile').fill('9900000303');
    await page.getByLabel('Contact email').fill('employer-pending@demo.vta.local');
    await page.getByRole('button', { name: 'Save company profile' }).click();
    await expect(page.getByText('Company profile saved')).toBeVisible();
    await page.getByRole('button', { name: 'Send to AutoTalent Grid' }).click();
    await expect(page.getByText(/Upload at least one registration document/)).toBeVisible();
    await page.getByRole('button', { name: 'Upload' }).click();
    const up = page.getByRole('dialog', { name: 'Upload registration document' });
    await up.getByLabel('File').setInputFiles({ name: 'gst-certificate.pdf', mimeType: 'application/pdf', buffer: PDF });
    await up.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Document uploaded')).toBeVisible();
    await page.getByRole('button', { name: 'Send to AutoTalent Grid' }).click();
    await expect(page.getByText('Sent to AutoTalent Grid for checking')).toBeVisible();

    const admin = await browser.newContext();
    const a = await admin.newPage();
    await signInEmail(a, EMAIL.opsAdmin);
    await a.goto('/admin/organisations?type=employer&verificationStatus=pending');
    await a.getByRole('button', { name: /Green Volt EV Garage/ }).click();
    const dialog = a.getByRole('dialog', { name: /Green Volt EV Garage/ });
    await expect(dialog.getByText('gst-certificate')).toBeVisible();
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(a.getByText('Organisation verified')).toBeVisible();
    await admin.close();

    await page.reload();
    await expect(page.getByText('Verified by AutoTalent Grid', { exact: true }).first()).toBeVisible();
  });
});
