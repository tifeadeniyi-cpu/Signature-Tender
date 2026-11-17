import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestMail } from './mail';

/** Sign it yourself with real sending on: a $0.99 checkout (local Stripe stand-in), then sign. */
const OWNER =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';
const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
const FLAGS = ['payments', 'production_signing'];
test.beforeAll(async () => {
  await sql`update feature_flags set enabled = true where key in ${sql(FLAGS)}`;
});
test.afterAll(async () => {
  await sql`update feature_flags set enabled = false where key in ${sql(FLAGS)}`;
  await sql.end();
});

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

test('sign it yourself: pay $0.99, then sign at once without using a credit', async ({ page }) => {
  test.setTimeout(150_000);
  const email = await signUpWithWorkspace(page, 'Pia Paid', 'Paid Solo');
  await prepareSelfSign(page, 'Car Bill of Sale.pdf');
  await expect(page.getByText(/\$0\.99 for this document, paid at checkout/)).toBeVisible();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Pay and sign now' }).click();
  await expect(page.getByText('Signature Tender: sign it yourself: 0.99 USD')).toBeVisible();
  await page.getByRole('button', { name: 'Pay' }).click();
  // The return page waits for the webhook, then opens signing.
  await expect(page).toHaveURL(/\/sign\/[A-Za-z0-9_-]{43}$/, { timeout: 30_000 });
  await signHere(page);
  await expect(latestMail(email, 'Please sign', 1500)).rejects.toThrow();
  await page.goto('/app/documents');
  await expect(
    page.getByRole('row', { name: /Car Bill of Sale/ }).getByText('Completed'),
  ).toBeVisible();
});
