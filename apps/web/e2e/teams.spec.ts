import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor, latestMail } from './mail';

async function makePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

test('an owner invites a teammate who signs up from the link and joins', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUpWithWorkspace(page, 'Ada Owner', 'Invite Studio');
  const email = `mate-${Date.now()}@example.test`;
  await page.goto('/app/team');
  await page.getByRole('button', { name: 'Invite Member' }).click();
  const form = page.getByRole('form', { name: 'Invite a member' });
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Role').selectOption({ label: 'Viewer' });
  await form.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(email)).toBeVisible();

  const link = await latestLinkFor(email, "You're invited to Invite Studio");
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await expect(guest.getByRole('heading', { name: 'Join Invite Studio' })).toBeVisible();
  await guest.getByRole('link', { name: 'Create an account' }).click();
  await guest.getByLabel('Full name').fill('Mo Mate');
  await guest.getByLabel('Email').fill(email);
  await guest.getByLabel('Password').fill('correct-horse-battery-staple');
  await guest.getByRole('button', { name: 'Create account' }).click();
  await expect(guest.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await guest.goto(await latestLinkFor(email, 'Verify your email'));
  await expect(guest.getByRole('heading', { name: 'Join Invite Studio' })).toBeVisible();
  await guest.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(guest).toHaveURL(/\/app$/);

  // The sidebar shows the viewer only what their role allows: no create button, no API settings.
  const side = guest.getByRole('complementary', { name: 'Sidebar' });
  await expect(side.getByRole('link', { name: 'Templates' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Create Document' })).toHaveCount(0);
  await side.getByRole('button', { name: 'Show Settings pages' }).click();
  await expect(side.getByRole('link', { name: 'Profile' })).toBeVisible();
  await expect(side.getByRole('link', { name: 'API Settings' })).toHaveCount(0);
  // Hiding is not access control: the page itself still refuses.
  await guest.goto('/app/settings/developers');
  await expect(
    guest.getByText('Only owners, admins and API developers can manage API keys'),
  ).toBeVisible();

  // The viewer cannot manage the team; the owner now sees them as a member.
  await guest.goto('/app/team');
  await expect(guest.getByRole('button', { name: 'Invite Member' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Manage Mo Mate' })).toBeVisible();
});

test('contacts can be added, searched, imported and exported', async ({ page }) => {
  await signUpWithWorkspace(page, 'Cy Contacts', 'Contact Studio');
  await page.goto('/app/contacts');
  await page.getByRole('button', { name: 'Add Contact' }).click();
  const add = page.getByRole('form', { name: 'Add contact' });
  await add.getByLabel('Full name').fill('Vera Venue');
  await add.getByLabel('Email', { exact: true }).fill('vera@venue.test');
  await add.getByLabel('Company', { exact: true }).fill('Blue Room');
  await add.getByLabel('Contact type').selectOption('venue');
  await add.getByLabel('Tags').fill('chicago, venue');
  await add.getByRole('button', { name: 'Add contact' }).click();
  await expect(page.getByText('Contact added.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vera Venue', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByLabel('CSV file').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Name,Email,Company\nArt Ist,art@ist.test,Label Co\nDup,vera@venue.test,\n',
    ),
  });
  await page
    .getByRole('form', { name: 'Import contacts' })
    .getByRole('button', { name: 'Import' })
    .click();
  await expect(page.getByText('Imported 1 contact; skipped 1.')).toBeVisible();

  await page.getByRole('searchbox').fill('label');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('link', { name: 'Art Ist', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vera Venue', exact: true })).toHaveCount(0);

  const res = await page.request.get('/api/contacts/export');
  expect(res.ok()).toBe(true);
  const csv = await res.text();
  expect(csv).toContain('vera@venue.test');
  expect(csv).toContain('art@ist.test');
});

test('a template is built, published and used to create a draft document', async ({ page }) => {
  test.setTimeout(120_000);
  await signUpWithWorkspace(page, 'Tia Templates', 'Template Studio');
  await page.goto('/app/templates');
  await page.getByRole('link', { name: 'Create Template' }).click();
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Booking.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Booking agreement'),
  });
  await page.getByLabel('Category').selectOption('Booking & Events');
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and add roles' }).click();
  await expect(page).toHaveURL(/roles$/);

  await page.getByLabel('Role name').fill('Artist');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/settings$/);
  await expect(page.getByLabel('Expiration date (optional)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/app\/templates\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Publish template' }).click();
  // The publish panel disappears once nothing is unpublished, so check the header instead.
  await expect(page.getByText(/Version 1 published/).first()).toBeVisible();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Use template' }).click();
  await page.getByLabel('Artist name').fill('Kit Artist');
  await page.getByLabel('Artist email').fill('kit@artist.test');
  await page.getByRole('button', { name: 'Create document' }).click();
  await expect(page).toHaveURL(/\/prepare\/review$/);
  await expect(page.getByText('Kit Artist')).toBeVisible();
  // Nothing is emailed until the sender sends.
  await expect(latestMail('kit@artist.test', 'Please sign', 1500)).rejects.toThrow();
});

test('branding rejects low-contrast colours and saves a readable one', async ({ page }) => {
  await signUpWithWorkspace(page, 'Bo Brand', 'Brand Studio');
  await page.goto('/app/settings/branding');
  await page.getByLabel('Name shown to recipients').fill('Bo Records');
  await page.getByLabel('Use a custom accent colour').check();
  await page.getByLabel('Hex').fill('#ffee00');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText(/too light for white text/)).toBeVisible();
  await page.getByLabel('Hex').fill('#1d3557');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText('Branding saved.')).toBeVisible();
});
