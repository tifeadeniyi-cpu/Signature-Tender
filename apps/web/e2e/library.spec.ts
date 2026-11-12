import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor, latestMail } from './mail';

async function makePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

/** Uploads a PDF, adds one signer with one signature field, and sends a free test request. */
async function sendTestRequest(page: Page, filename: string, signerName: string, email: string) {
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: await makePdf(filename),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/signers$/);
  await page.getByLabel('Full name').first().fill(signerName);
  await page.getByLabel('Email', { exact: true }).first().fill(email);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/documents\/[0-9a-f-]{36}$/);
  return page.url();
}

async function verifyRetrieval(page: Page, email: string) {
  await page.goto('/retrieve');
  await page.getByLabel('Email address the documents were sent to').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText(`If any documents were sent to ${email}`)).toBeVisible();
  const mail = await latestMail(email, 'Your document access code');
  await page.getByLabel('6-digit code').fill(mail.subject.match(/(\d{6})/)![1]!);
  await page.getByRole('button', { name: 'Verify and show my documents' }).click();
  await expect(page.getByText(`Showing documents sent to ${email}`)).toBeVisible();
}

test('a recipient without an account gets a new link, signs, and downloads the copy', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUpWithWorkspace(page, 'Lib Sender', 'Library Studio');
  const email = `lost-${Date.now()}@example.test`;
  const docUrl = await sendTestRequest(page, 'Rider.pdf', 'Kit Guest', email);
  const firstLink = await latestLinkFor(email, 'Please sign');

  // An address with no documents gets exactly the same answer, so addresses cannot be probed.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto('/retrieve');
  const nobody = `nobody-${Date.now()}@example.test`;
  await guest.getByLabel('Email address the documents were sent to').fill(nobody);
  await guest.getByRole('button', { name: 'Email me a code' }).click();
  await expect(guest.getByText(`If any documents were sent to ${nobody}`)).toBeVisible();
  await expect(latestMail(nobody, 'access code', 1500)).rejects.toThrow();

  // The real recipient verifies, sees the waiting request, and asks for a fresh link.
  await verifyRetrieval(guest, email);
  const item = guest.getByRole('listitem').filter({ hasText: 'Rider' });
  await expect(item.getByText('Waiting for you')).toBeVisible();
  await item.getByRole('button', { name: 'Email me a new signing link' }).click();
  await expect(item.getByText(/Older links no longer work/)).toBeVisible();
  const newLink = await (async () => {
    for (let i = 0; i < 40; i++) {
      const l = await latestLinkFor(email, 'Please sign');
      if (l !== firstLink) return l;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('No new link');
  })();

  // The old link stops working; the new one signs.
  const old = await (await browser.newContext()).newPage();
  await old.goto(firstLink);
  await expect(old.getByRole('button', { name: 'Start review' })).toHaveCount(0);
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(newLink);
  await signer.getByRole('button', { name: 'Start review' }).click();
  await signer.getByLabel('I agree to use electronic records').check();
  await signer.getByRole('button', { name: 'Continue' }).click();
  await signer.getByRole('button', { name: /Add your signature/ }).click();
  await signer.getByRole('button', { name: 'Adopt and use signature' }).click();
  await signer.getByRole('button', { name: 'Finish signing' }).click();
  await signer.getByLabel(/intend to sign it electronically/).check();
  await signer.getByRole('button', { name: 'Sign document' }).click();
  await expect(signer.getByRole('heading', { name: 'This document is complete' })).toBeVisible({
    timeout: 20_000,
  });

  // Back in the same retrieval session, the completed copy and certificate download.
  await guest.reload();
  await expect(item.getByText('Completed')).toBeVisible();
  for (const name of ['Signed copy', 'Certificate']) {
    const res = await guest.request.get(
      (await item.getByRole('link', { name }).getAttribute('href')) as string,
    );
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  }
  // Without the session cookie the same download is refused.
  const anon = await (
    await browser.newContext()
  ).request.get(
    (await item.getByRole('link', { name: 'Signed copy' }).getAttribute('href')) as string,
  );
  expect(anon.status()).toBe(401);
  await guest.getByRole('button', { name: 'Done, sign out' }).click();
  await expect(guest.getByRole('button', { name: 'Email me a code' })).toBeVisible();

  // The sender sees every step, including the link reissue and the guest download.
  await page.goto(`${docUrl}?tab=activity`);
  await expect(page.getByText('Asked for a new signing link · Kit Guest')).toBeVisible();
  await expect(
    page.getByText('Downloaded a copy from Get your documents · Kit Guest').first(),
  ).toBeVisible();
  await page.goto(`${docUrl}?tab=versions`);
  await expect(page.getByRole('cell', { name: 'Original upload', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Signed copy', exact: true })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Completion certificate', exact: true }),
  ).toBeVisible();
  const original = await page.request.get(
    (await page
      .getByRole('link', { name: 'Download Original upload' })
      .getAttribute('href')) as string,
  );
  expect(original.status()).toBe(200);
  // Checking a copy compares fingerprints in the browser.
  await page.getByLabel('Check a copy').setInputFiles({
    name: 'Rider-copy.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await original.body()),
  });
  await expect(
    page.getByText('Matches the original upload. It has not been changed.'),
  ).toBeVisible();
  await page.getByLabel('Check a copy').setInputFiles({
    name: 'Other.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Something else'),
  });
  await expect(page.getByText(/Other\.pdf does not match/)).toBeVisible();
});

test('search, filter, archive and set retention in the library', async ({ page }) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Ari Archivist', 'Archive House');
  const email = `lib-${Date.now()}@example.test`;
  await sendTestRequest(page, 'Booking.pdf', 'Max Booker', email);

  await page.goto('/app/documents');
  await expect(page.getByRole('link', { name: /^All/ })).toContainText('1');
  const table = page.getByRole('table');
  await expect(table.getByRole('link', { name: 'Booking', exact: true })).toBeVisible();

  // Search by the signer's email, then for something that does not exist.
  await page.getByRole('searchbox').fill(email);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(table.getByRole('link', { name: 'Booking', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('no-such-document-xyz');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('heading', { name: 'No documents match' })).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();

  // Open requests cannot be archived; cancel first, then archive and unarchive.
  // View opens the details drawer; its View Document link goes to the full page.
  await page.getByRole('link', { name: 'View Booking' }).click();
  await page
    .getByRole('dialog', { name: 'Booking' })
    .getByRole('link', { name: 'View Document' })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/documents\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByRole('button', { name: 'Archive Booking' })).toBeVisible();
  await page.goto('/app/documents?tab=cancelled');
  await page.getByRole('button', { name: 'Archive Booking' }).click();
  await expect(page.getByRole('link', { name: 'Booking', exact: true })).toHaveCount(0);
  await page.goto('/app/documents?tab=archived');
  await expect(page.getByRole('link', { name: 'Booking', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unarchive Booking' }).click();
  await expect(page.getByRole('link', { name: 'Booking', exact: true })).toHaveCount(0);

  // Retention: the minimum is enforced, and a valid period saves.
  await page.goto('/app/settings/retention');
  const field = page.getByLabel('Workspace default');
  await field.fill('30');
  await field.evaluate((el: HTMLInputElement) => el.removeAttribute('min'));
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText(/Keep records for at least 365 days/)).toBeVisible();
  await field.fill('3650');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Retention saved.')).toBeVisible();
});
