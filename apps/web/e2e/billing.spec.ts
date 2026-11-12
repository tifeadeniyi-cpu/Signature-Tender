import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor, latestMail } from './mail';

// Payments run against a local Stripe stand-in (see stripe-stub.mjs) that sends signed webhooks.
// The release flags are switched on in the test database for this file only.
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

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Venue Agreement', { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

test('pay for one request, then buy a credit pack, all confirmed by webhook', async ({ page }) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Pat Payer', 'Payer Events');
  const signerEmail = `paid-signer-${Date.now()}@example.test`;

  // Billing starts as pay-as-you-go with no credits.
  await page.goto('/app/billing');
  await expect(page.getByText('Pay As You Go — No Subscription')).toBeVisible();
  await expect(page.getByText('Stripe test mode.')).toBeVisible();

  // Prepare a document with one signer.
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Venue.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/signers$/);
  await page.getByLabel('Full name').first().fill('Lee Signer');
  await page.getByLabel('Email', { exact: true }).first().fill(signerEmail);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();

  // Real sending with no credits: the request waits for payment and nobody is emailed.
  await expect(
    page.getByText(/You have no credits\. After you press send you can pay \$2\.99/),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await expect(page.getByRole('heading', { name: 'Payment needed to send' })).toBeVisible();
  await expect(page.getByText('Not sent yet.')).toBeVisible();
  await expect(latestMail(signerEmail, 'Please sign', 1500)).rejects.toThrow();
  const docUrl = page.url();

  // Cancelling checkout changes nothing.
  await page.getByRole('button', { name: 'Pay $2.99 and send' }).click();
  await expect(
    page.getByRole('heading', { name: 'Test checkout (local Stripe stand-in)' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page.getByText('Checkout was cancelled. You have not been charged.')).toBeVisible();

  // Pay: the webhook confirms the payment and the request is sent.
  await page.getByRole('button', { name: /Pay( again)? \(\$2\.99\)|Pay \$2\.99 and send/ }).click();
  await expect(page.getByText('Signature Tender: signing request: 2.99 USD')).toBeVisible();
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible();
  await expect(
    page.getByText('Your request has been sent and recipients have been emailed.'),
  ).toBeVisible();
  const mail = await latestMail(signerEmail, 'Please sign');
  expect(mail.subject).not.toContain('[TEST]');
  expect(await latestLinkFor(signerEmail, 'Please sign')).toMatch(/\/sign\/[A-Za-z0-9_-]{43}$/);
  await page.goto(docUrl);
  await expect(page.getByRole('heading', { name: 'Payment needed to send' })).toHaveCount(0);
  await expect(page.getByText('This is a test request.')).toHaveCount(0);

  // Buy a 5-credit pack.
  await page.goto('/app/billing?tab=credits');
  await expect(page.getByText('Save 13%')).toBeVisible();
  await page.getByRole('button', { name: 'Buy 5 credits' }).click();
  await expect(page.getByText('Signature Tender: 5 prepaid credits: 12.99 USD')).toBeVisible();
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByText('5 credits have been added to your workspace.')).toBeVisible();

  // Balances, history and reconciliation reflect both payments.
  await page.goto('/app/billing?tab=credits');
  const balance = page.locator('section', { hasText: 'Available balance' });
  await expect(balance.getByText('5', { exact: true })).toBeVisible();
  await page.goto('/app/billing?tab=payments');
  await expect(page.getByRole('cell', { name: /Credit purchase/ })).toBeVisible();
  // The abandoned checkout stays in the history as not completed, next to the paid one.
  await expect(page.getByRole('cell', { name: /Single request/ })).toHaveCount(2);
  await expect(page.getByText('Not completed', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Paid', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Every paid purchase matches the credits added')).toBeVisible();
  await expect(page.getByText('Used for a request')).toBeVisible();
});

test('the webhook rejects unsigned and forged events', async ({ request }) => {
  const body = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: {} });
  const missing = await request.post('/api/stripe/webhook', { data: body });
  expect(missing.status()).toBe(400);
  const forged = await request.post('/api/stripe/webhook', {
    data: body,
    headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` },
  });
  expect(forged.status()).toBe(400);
});
