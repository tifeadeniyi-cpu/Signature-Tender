import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor, latestMail } from './mail';

async function makePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++)
    doc.addPage([612, 792]).drawText(`${text} p${i + 1}`, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

async function sendAndSign(page: Page, browser: import('@playwright/test').Browser, email: string) {
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Fictional Booking Agreement.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf('Fictional Booking Agreement'),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await page.getByLabel('Full name').first().fill('Tess Tester');
  await page.getByLabel('Email', { exact: true }).first().fill(email);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('img', { name: 'Page 1 of 2' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();
  const docUrl = page.url();

  // Nothing is sent before completion.
  await expect(latestMail(email, 'Your Document Is Complete', 1500)).rejects.toThrow();

  const signer = await (await browser.newContext()).newPage();
  await signer.goto(await latestLinkFor(email, 'Please sign'));
  await signer.getByRole('button', { name: /^Review/ }).click();
  await signer.getByLabel('I agree to use electronic records').check();
  await signer.getByRole('button', { name: 'Continue' }).click();
  await signer.getByRole('button', { name: /^Sign here/ }).click();
  await signer.getByRole('button', { name: 'Use This Signature' }).click();
  await signer
    .getByRole('navigation', { name: 'Field navigation' })
    .getByRole('button', { name: 'Finish Signing' })
    .click();
  await signer.getByLabel(/intend to sign it electronically/).check();
  await signer.getByRole('button', { name: 'Complete Signing' }).click();
  await expect(signer.getByRole('heading', { name: "You've Completed Your Signing" })).toBeVisible({
    timeout: 20_000,
  });
  return docUrl;
}

function linkFrom(text: string, label: string) {
  const m = text.match(new RegExp(`${label}: (\\S+)`));
  if (!m) throw new Error(`No "${label}" link in email`);
  return m[1]!;
}

test('completion email: recipient verifies, views, downloads and opens the evidence certificate', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const senderEmail = await signUpWithWorkspace(page, 'Cam Sender', 'Cam Bookings');
  const email = `done-${Date.now()}@example.test`;
  const docUrl = await sendAndSign(page, browser, email);

  // Recipient and sender each get their own completion email, with real document details.
  const mail = await latestMail(email, 'Your Document Is Complete', 20_000);
  expect(mail.subject).toBe(
    '[TEST] Your Document Is Complete — Fictional Booking Agreement | Signature Tender',
  );
  expect(mail.text).toContain('All required signatures have been collected.');
  expect(mail.text).toContain('Sender: Cam Sender');
  expect(mail.text).toContain('Signers: 1 of 1 Completed');
  expect(mail.text).toContain('Pages: 2');
  const html = (mail as unknown as { html: string }).html;
  expect(html).toContain('Document Successfully Completed');
  expect(html).toContain('cid:logo-reversed@signaturetender');
  const senderMail = await latestMail(senderEmail, 'Your Document Is Complete', 20_000);
  expect(linkFrom(senderMail.text, 'View Document')).toMatch(/\/app\/documents\/[0-9a-f-]{36}$/);

  const view = linkFrom(mail.text, 'View Document');
  const download = linkFrom(mail.text, 'Download Signed Document');
  const evidence = linkFrom(mail.text, 'View Evidence Certificate');
  expect(view).toMatch(/\/retrieve\/link\/[A-Za-z0-9_-]{43}\?to=view$/);

  // A forwarded email is not enough: the link asks for a code sent to the original address.
  const forwarded = await (await browser.newContext()).newPage();
  await forwarded.goto(view);
  await expect(forwarded.getByRole('heading', { name: 'Open your document' })).toBeVisible();
  await expect(forwarded.getByText(/d•+@example\.test/)).toBeVisible();
  await expect(forwarded.getByRole('img', { name: /Page 1/ })).toHaveCount(0);

  // The real recipient verifies with the code from their inbox and lands on the document.
  const guest = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await guest.goto(view);
  await guest.getByRole('button', { name: 'Email me a code' }).click();
  await expect(guest.getByText(/We emailed a 6-digit code/)).toBeVisible();
  const codeMail = await latestMail(email, 'Your document access code');
  await guest.getByLabel('6-digit code').fill(codeMail.subject.match(/(\d{6})/)![1]!);
  await guest.getByRole('button', { name: 'Verify and open the document' }).click();
  await expect(guest).toHaveURL(/\/retrieve\/documents\/[0-9a-f-]{36}$/);
  await expect(guest.getByRole('heading', { name: 'Fictional Booking Agreement' })).toBeVisible();
  await expect(guest.getByRole('list', { name: 'Signers' }).getByText('Tess Tester')).toBeVisible();
  await expect(guest.getByRole('img', { name: /^Page 2 of \d+$/ })).toBeVisible({
    timeout: 15_000,
  });
  // The forwarded browser still cannot fetch the file, even knowing the request id.
  const requestId = guest.url().split('/').at(-1);
  const blocked = await forwarded.request.get(`/api/retrieve/${requestId}/file?kind=signed`);
  expect(blocked.status()).toBe(401);

  // Download button: already verified in this browser, so it goes straight to the file.
  const dl = guest.waitForEvent('download');
  await guest.goto(download);
  expect((await dl).suggestedFilename()).toMatch(/\.pdf$/);
  const file = await guest.request.get(
    (await guest
      .getByRole('toolbar')
      .getByRole('link', { name: 'Download' })
      .getAttribute('href'))!,
  );
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Evidence certificate: integrity references, signing events and a certificate download.
  await guest.goto(evidence);
  await expect(guest.getByRole('heading', { name: 'Integrity references' })).toBeVisible();
  await guest.getByText(/^Signing events/).click();
  await expect(guest.getByText('Completed: signed copy and certificate created')).toBeVisible();
  const cert = await guest.request.get(
    (await guest
      .getByRole('toolbar')
      .getByRole('link', { name: 'Download' })
      .getAttribute('href'))!,
  );
  expect(cert.headers()['content-disposition']).toContain('certificate');
  expect(cert.status()).toBe(200);

  // The sender sees the emails and the recipient's access in Activity.
  await page.goto(docUrl);
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page).toHaveURL(/tab=activity/);
  await expect(page.getByText('Completion email sent · Tess Tester')).toBeVisible();
  await expect(page.getByText('Completion email sent · Cam Sender')).toBeVisible();
  await expect(
    page.getByText('Viewed the completed copy from a secure link · Tess Tester').first(),
  ).toBeVisible();
  await expect(
    page.getByText('Downloaded a copy from Get your documents · Tess Tester').first(),
  ).toBeVisible();

  // An invalid link shows a clear message.
  await forwarded.goto('/retrieve/link/not-a-real-token');
  await expect(forwarded.getByText('This link is not valid.')).toBeVisible();
});

test('email previews render for signed-in users', async ({ page }) => {
  await signUpWithWorkspace(page, 'Pia Preview', 'Pia Studio');
  await page.goto('/app/dev/emails?variant=sender&width=mobile');
  await expect(
    page.getByText('Your Document Is Complete — Sample Artist Management Agreement'),
  ).toBeVisible();
  const frame = page.frameLocator('iframe[title="Email preview"]');
  await expect(
    frame.getByRole('heading', { name: 'Document Successfully Completed' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Send this preview to me' }).click();
  await expect(page.getByText(/Preview sent to/)).toBeVisible();
});
