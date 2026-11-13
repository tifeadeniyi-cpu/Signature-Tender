import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestMail } from './mail';

/** Sign it yourself, in test mode (free): upload, place your signature, sign straight away. */

async function makePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

async function signHere(page: Page) {
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.getByLabel('I agree to use electronic records').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Sign here/ }).click();
  await page.getByRole('button', { name: 'Use This Signature' }).click();
  await page
    .getByRole('navigation', { name: 'Field navigation' })
    .getByRole('button', { name: 'Finish Signing' })
    .click();
  await page.getByLabel(/intend to sign it electronically/).check();
  await page.getByRole('button', { name: 'Complete Signing' }).click();
  await expect(page.getByRole('heading', { name: "You've Completed Your Signing" })).toBeVisible({
    timeout: 20_000,
  });
}

async function prepareSelfSign(page: Page, filename: string) {
  await page.goto('/app/documents');
  await page.getByRole('link', { name: 'Sign it yourself' }).click();
  await expect(page.getByRole('heading', { name: 'Sign a document yourself' })).toBeVisible();
  await expect(page.getByText(/\$0\.99 per document/)).toBeVisible();
  await page.getByLabel('PDF file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: await makePdf(filename),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  // No signers step: you are the only signer.
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
}

test('sign it yourself: no signers step, no email, straight to signing', async ({ page }) => {
  test.setTimeout(120_000);
  const email = await signUpWithWorkspace(page, 'Sol Self', 'Solo Works');
  await prepareSelfSign(page, 'My Lease.pdf');
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Sign a test copy now' }).click();
  await expect(page).toHaveURL(/\/sign\/[A-Za-z0-9_-]{43}$/);
  await signHere(page);
  // Nobody was emailed a signing link, including you.
  await expect(latestMail(email, 'Please sign', 1500)).rejects.toThrow();
  await page.goto('/app/documents');
  await expect(page.getByRole('row', { name: /My Lease/ }).getByText('Completed')).toBeVisible();
});
