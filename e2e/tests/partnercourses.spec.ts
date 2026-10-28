import { expect, test } from '@playwright/test';
import { signInEmail } from './helpers.js';

/**
 * Training partner course creation and approval journey (wireframe of 27 Oct 2026):
 * the partner builds a course in four steps and submits it; AutoTalent Grid approves and publishes it;
 * learners then find it in the catalogue with the fee including GST.
 */
const TITLE = 'Two-Wheeler FI Diagnostics (browser test)';
// A tiny valid PNG (1x1 pixel).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('partner creates and submits a course; admin approves and publishes it; learners see it', async ({ browser }) => {
  // The partner's phone shares its location when asked (VOC Bengaluru, Peenya).
  const partnerContext = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 13.0285, longitude: 77.5197 } });
  const partner = await partnerContext.newPage();
  await signInEmail(partner, 'partner-a@demo.vta.local');
  await expect(partner.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  await expect(partner.getByText('Recent activities')).toBeVisible();
  await partner.getByRole('main').getByRole('link', { name: 'Create course' }).click();

  // Step 1: basic details
  await expect(partner.getByRole('heading', { name: 'Create course' })).toBeVisible();
  await partner.getByLabel('Course title').fill(TITLE);
  await partner.getByLabel('Category').selectOption('2W');
  await partner.getByLabel('Level').selectOption('beginner_to_intermediate');
  await partner.getByRole('radio', { name: 'Skill upgrade' }).click();
  await partner.getByLabel('Description').fill('Fuel-injection diagnostics for current two-wheelers, with scan tools and live faults.');
  await partner.getByLabel('Location (city)').fill('Bengaluru');
  await partner.getByLabel('Duration').fill('4');
  await partner.getByRole('radio', { name: 'Hybrid' }).click();
  await partner.locator('#w-image').setInputFiles({ name: 'course.png', mimeType: 'image/png', buffer: PNG });
  await partner.getByRole('button', { name: 'Save & continue' }).click();

  // Step 2: content
  await expect(partner.getByRole('heading', { name: 'Add course content' })).toBeVisible();
  // A hybrid course: each module has theory and practical time; the total is added up.
  await expect(partner.getByText('Hybrid course: enter the theory and practical time of each module.')).toBeVisible();
  for (const [name, theory, practical] of [['FI system basics', '14', '6'], ['Scan tool diagnostics', '20', '10']] as const) {
    await partner.getByLabel('Module name').fill(name);
    await partner.getByLabel('Theory').fill(theory);
    await partner.getByLabel('Practical').fill(practical);
    await partner.getByRole('button', { name: 'Add', exact: true }).first().click();
  }
  await expect(partner.getByText('Total 50 hours')).toBeVisible();
  await expect(partner.getByText('34 h theory + 16 h practical')).toBeVisible();
  await expect(partner.getByRole('cell', { name: /^20 h\s*Theory 14 h\s*Practical 6 h$/ })).toBeVisible();
  // Time can also be typed in minutes; it is shown in hours.
  await partner.getByLabel('Module name').fill('Workshop safety briefing');
  await partner.getByLabel('Unit').selectOption('minutes');
  await partner.getByLabel('Theory').fill('20');
  await partner.getByLabel('Practical').fill('10');
  await expect(partner.getByText('Total 0.5 h')).toBeVisible();
  await partner.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(partner.getByText('Total 50.5 hours')).toBeVisible();
  await partner.getByRole('button', { name: 'FI System', exact: true }).click();
  await partner.getByRole('button', { name: 'Electrical Diagnostics', exact: true }).click();
  await partner.getByLabel('Prerequisites').fill('10th pass');
  await partner.getByLabel('Add a learning outcome').fill('Read and clear FI fault codes');
  await partner.getByLabel('Add a learning outcome').press('Enter');
  await partner.getByRole('button', { name: 'Save & continue' }).click();

  // Step 3: fee and first batch
  await expect(partner.getByRole('heading', { name: 'Fee & batch setup' })).toBeVisible();
  await partner.getByLabel('Course fee (₹)').fill('5000');
  await partner.getByLabel('GST').selectOption('18');
  await expect(partner.getByText('₹5,900')).toBeVisible();
  await partner.getByLabel('Certificate type').selectOption('Partner Certificate');
  await partner.getByLabel('Batch name').fill('FI Peenya December 2026');
  // A centre missing from the list is added on the spot, with its map location from the phone.
  await partner.getByLabel('Location (centre)').selectOption({ label: '+ Add a new centre' });
  const add = partner.getByRole('dialog', { name: 'Add a new centre' });
  await add.getByLabel('Centre name').fill('VOC Bengaluru');
  await add.getByLabel('City').fill('Bengaluru');
  await add.getByRole('button', { name: 'Use my current location' }).click();
  await expect(add.getByText('Pinned 13.02850, 77.51970')).toBeVisible();
  await expect(add.getByRole('link', { name: 'View on Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=13.028500,77.519700');
  await add.getByRole('button', { name: 'Add centre' }).click();
  await expect(add).toBeHidden();
  await expect(partner.getByLabel('Location (centre)')).toHaveValue(/[0-9a-f-]{36}/);
  await expect(partner.getByLabel('Location (centre)').locator('option:checked')).toHaveText('VOC Bengaluru, Bengaluru');
  // This batch runs at Peenya, where the trainer is.
  await partner.getByLabel('Location (centre)').selectOption({ label: 'Skill Bridge Peenya Centre, Bengaluru' });
  await partner.getByLabel('Start date').fill('2026-12-01');
  await partner.getByLabel('End date').fill('2026-12-31');
  await partner.getByLabel('Trainer').selectOption({ label: 'Prakash Trainer' });
  await partner.getByLabel('Total seats').fill('20');
  await partner.getByLabel('Class timings').fill('Mon–Fri, 2–5 PM');
  await partner.getByRole('button', { name: 'Save & continue' }).click();

  // Step 4: review and submit
  await expect(partner.getByRole('heading', { name: 'Review & submit' })).toBeVisible();
  await expect(partner.getByText('Scan tool diagnostics')).toBeVisible();
  await expect(partner.getByText('Prakash Trainer')).toBeVisible();
  await partner.getByRole('button', { name: 'Submit for admin review' }).click();
  await expect(partner.getByText('Submitted for admin review.')).toBeVisible();
  await expect(partner.getByRole('main').getByText('Submitted for review').first()).toBeVisible();
  await expect(partner.getByText('Opens on publish')).toBeVisible();

  // Not visible to learners yet.
  const visitor = await browser.newPage();
  await visitor.goto('/courses');
  await expect(visitor.getByRole('heading', { name: '2W Service Technician', exact: true })).toBeVisible();
  await expect(visitor.getByRole('heading', { name: TITLE })).toHaveCount(0);

  // Admin reviews it.
  const admin = await browser.newPage();
  await signInEmail(admin, 'superadmin@demo.vta.local');
  await admin.getByRole('link', { name: /Course approvals/ }).first().click();
  await expect(admin.getByRole('heading', { name: 'Course approvals' })).toBeVisible();
  await admin.getByRole('link', { name: new RegExp(TITLE.replace(/[()]/g, '\\$&')) }).click();
  await expect(admin.getByText('Pending review')).toBeVisible();
  await admin.getByRole('tab', { name: 'Content' }).click();
  await expect(admin.getByText('FI system basics')).toBeVisible();
  await admin.getByRole('tab', { name: 'Partner details' }).click();
  await expect(admin.getByText('Skill Bridge Peenya Centre')).toBeVisible();
  await admin.getByRole('button', { name: 'Approve & publish' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Approve & publish' }).click();
  await expect(admin.getByRole('main').getByText('Published').first()).toBeVisible();

  // Learners now see it, with the fee including GST, skills and seats.
  await visitor.reload();
  const card = visitor.getByRole('listitem').filter({ has: visitor.getByRole('heading', { name: TITLE }) });
  await expect(card).toBeVisible();
  await expect(card.getByText('₹5,900')).toBeVisible();
  await expect(card.getByText('incl. GST')).toBeVisible();
  await expect(card.getByText('FI System')).toBeVisible();
  await expect(card.getByText('20 seats left')).toBeVisible();
  await expect(card.getByText('Skill Bridge Foundation (demo)')).toBeVisible();

  // Course management: the first batch is live; the partner adds another.
  await partner.reload();
  await expect(partner.getByRole('main').getByText('Published').first()).toBeVisible();
  await expect(partner.getByRole('cell', { name: /FI Peenya December 2026/ })).toBeVisible();
  await partner.getByRole('button', { name: 'Create batch' }).click();
  const dialog = partner.getByRole('dialog');
  await dialog.getByLabel('Batch name').fill('FI Peenya January 2027');
  await dialog.getByLabel('Centre').selectOption({ label: 'Skill Bridge Peenya Centre, Bengaluru (Skill Bridge Foundation (demo))' });
  await dialog.getByLabel('Trainer').selectOption({ index: 1 });
  await dialog.getByLabel('Start date').fill('2027-01-11');
  await dialog.getByLabel('End date').fill('2027-02-12');
  await dialog.getByRole('button', { name: 'Create batch' }).click();
  await expect(partner.getByRole('cell', { name: /FI Peenya January 2027/ })).toBeVisible();
  await expect(partner.getByText('Upcoming').first()).toBeVisible();
});
