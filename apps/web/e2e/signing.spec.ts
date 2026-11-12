import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor, latestMail } from './mail';

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  p.drawText('Performance Agreement', { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

test('send a test request, sign with an email code, and download the completed copy', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Sol Sender', 'Sol Records');
  const signerEmail = `signer-${Date.now()}@example.test`;

  // Prepare: upload, one signer who must confirm an email code, a signature and a text field.
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Performance.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/signers$/);
  await page.getByLabel('Full name').first().fill('Rae Signer');
  await page.getByLabel('Email', { exact: true }).first().fill(signerEmail);
  await page.getByLabel('Verification').first().selectOption('email_code');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  const canvas = page.getByRole('img', { name: 'Page 1 of 1' });
  await canvas.click({ position: { x: 200, y: 500 } });
  await page.getByRole('radio', { name: 'Text' }).click();
  await canvas.click({ position: { x: 200, y: 600 } });
  await page.getByLabel('Label').fill('Stage name');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
  await page.getByRole('button', { name: 'Send test request' }).click();

  // Sender sees the request with a TEST marker; the draft can no longer be edited.
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();
  await expect(page.getByText('This is a test request.')).toBeVisible();
  const docUrl = page.url();
  await page.goto(`${docUrl}/prepare/fields`);
  await expect(page).toHaveURL(docUrl);

  // Recipient flow in a separate browser.
  const link = await latestLinkFor(signerEmail, 'Please sign');
  expect(link).toMatch(/\/sign\/[A-Za-z0-9_-]{43}$/);
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(link);
  await expect(signer.getByText('Test request from a non-production environment')).toBeVisible();
  await expect(signer.getByRole('heading', { name: 'Performance' })).toBeVisible();
  await signer.getByRole('button', { name: 'Email me a code' }).click();
  await expect(signer.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await signer.getByLabel('Code').fill('000000');
  await signer.getByRole('button', { name: 'Verify and continue' }).click();
  const codeMail = await latestMail(signerEmail, 'Your signing code');
  const code = codeMail.subject.match(/(\d{6})/)![1]!;
  if (code !== '000000') await expect(signer.getByText(/not correct/)).toBeVisible();
  await signer.getByLabel('Code').fill(code);
  await signer.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(signer.getByRole('heading', { name: 'Sign electronically' })).toBeVisible();
  await signer.getByLabel('I agree to use electronic records').check();
  await signer.getByRole('button', { name: 'Continue' }).click();

  await expect(signer.getByText('0 of 2 required fields complete')).toBeVisible();
  await expect(signer.getByRole('button', { name: 'Finish signing' })).toBeDisabled();
  await signer.getByRole('button', { name: /Add your signature/ }).click();
  const dialog = signer.getByRole('dialog', { name: 'Adopt your signature' });
  await expect(dialog.getByLabel('Your full name')).toHaveValue('Rae Signer');
  await dialog.getByRole('button', { name: 'Adopt and use signature' }).click();
  await expect(dialog).toBeHidden();
  await signer.getByRole('button', { name: 'Next required field' }).click();
  await signer.getByLabel('Stage name (required)').fill('RAE');
  await expect(signer.getByText('2 of 2 required fields complete')).toBeVisible();
  await signer.getByRole('button', { name: 'Finish signing' }).click();
  await signer.getByLabel(/intend to sign it electronically/).check();
  await signer.getByRole('button', { name: 'Sign document' }).click();
  await expect(signer.getByRole('heading', { name: 'This document is complete' })).toBeVisible({
    timeout: 20_000,
  });
  const dl = await signer.request.get(`${link.replace('/sign/', '/api/sign/')}/signed`);
  expect(dl.status()).toBe(200);
  expect((await dl.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Sender: completed, downloads work, integrity holds, emails went out.
  await latestMail(signerEmail, 'Completed:');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  const signed = await page.request.get(
    (await page.getByRole('link', { name: 'Download signed copy' }).getAttribute('href')) as string,
  );
  expect(signed.status()).toBe(200);
  const cert = await page.request.get(
    (await page.getByRole('link', { name: 'Download certificate' }).getAttribute('href')) as string,
  );
  expect(cert.status()).toBe(200);
  await page.getByRole('button', { name: 'Verify integrity' }).click();
  await expect(page.getByText(/Evidence log: intact/)).toBeVisible();
  await expect(page.getByText('Signed copy: matches its recorded hash')).toBeVisible();

  // The source preview needs an active signing session; a bare link cannot fetch it.
  const anon = await (
    await browser.newContext()
  ).request.get(`${link.replace('/sign/', '/api/sign/')}/file`);
  expect(anon.status()).toBe(404);
});

test('a recipient can decline, and an unknown link shows a clear message', async ({
  page,
  browser,
}) => {
  await signUpWithWorkspace(page, 'Dee Sender', 'Dee Co');
  const email = `decliner-${Date.now()}@example.test`;
  await page.goto('/app/documents/new');
  await page
    .getByLabel('PDF file')
    .setInputFiles({ name: 'Offer.pdf', mimeType: 'application/pdf', buffer: await makePdf() });
  await page.getByLabel('Document type').selectOption('other');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await page.getByLabel('Full name').first().fill('Dan Decliner');
  await page.getByLabel('Email', { exact: true }).first().fill(email);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();

  const link = await latestLinkFor(email, 'Please sign');
  const r = await (await browser.newContext()).newPage();
  await r.goto(link);
  await r.getByRole('button', { name: 'Start review' }).click();
  await expect(r.getByRole('heading', { name: 'Sign electronically' })).toBeVisible();
  await r.getByRole('button', { name: 'Decline to sign' }).click();
  await r.getByLabel(/Reason/).fill('Terms changed');
  await r.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(r.getByRole('heading', { name: 'Signing was declined' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Dan Decliner declined to sign: "Terms changed"')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit and send again' })).toBeVisible();

  const bogus = await (await browser.newContext()).newPage();
  await bogus.goto('/sign/' + 'A'.repeat(43));
  await expect(bogus.getByRole('heading', { name: 'This link is not available' })).toBeVisible();
});
