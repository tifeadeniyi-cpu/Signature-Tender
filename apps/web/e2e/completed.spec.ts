import { test, expect, type Browser, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor, latestMail } from './mail';

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Service Agreement page ${n}`, { x: 72, y: 700, size: 20, font });
  }
  return Buffer.from(await doc.save());
}

/** Sends a one-signer test request and signs it in a fresh browser. Returns the signer's page. */
async function sendAndSign(
  page: Page,
  browser: Browser,
  opts: { email: string; name: string; emailCode: boolean },
) {
  await signUpWithWorkspace(page, 'Jordan Lee', 'Lee Services');
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Service Agreement.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/signers$/);
  await page.getByLabel('Full name').first().fill(opts.name);
  await page.getByLabel('Email', { exact: true }).first().fill(opts.email);
  if (opts.emailCode) await page.getByLabel('Verification').first().selectOption('email_code');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 2' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();

  const link = await latestLinkFor(opts.email, 'Please sign');
  const token = link.split('/sign/')[1]!;
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(link);
  if (opts.emailCode) {
    await signer.getByRole('button', { name: /^Review/ }).click();
    const mail = await latestMail(opts.email, 'Your signing code');
    await signer.getByLabel('Code').fill(mail.subject.match(/(\d{6})/)![1]!);
    await signer.getByRole('button', { name: 'Verify and continue' }).click();
  } else {
    await signer.getByRole('button', { name: /^Review/ }).click();
  }
  await signer.getByLabel('I agree to use electronic records').check();
  await signer.getByRole('button', { name: 'Continue' }).click();
  await signer.getByRole('button', { name: /Add your signature/ }).click();
  await signer
    .getByRole('dialog', { name: 'Adopt your signature' })
    .getByRole('button', { name: 'Adopt and use signature' })
    .click();
  await signer.getByRole('button', { name: 'Finish signing' }).click();
  await signer.getByLabel(/intend to sign it electronically/).check();
  await signer.getByRole('button', { name: 'Sign document' }).click();
  await latestMail(opts.email, 'Your Document Is Complete', 20_000);
  return { signer, token };
}

test('completed page: view, download, evidence, dismiss the offer, then create an account and claim', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const email = `alex-${Date.now()}@example.test`;
  const { signer, token } = await sendAndSign(page, browser, {
    email,
    name: 'Alex Morgan',
    emailCode: false,
  });

  await signer.goto(`/sign/completed/${token}`);
  await expect(signer.getByRole('heading', { name: 'This Document Is Completed' })).toBeVisible();
  await expect(signer.getByText('All required parties have signed.')).toBeVisible();
  await expect(signer.getByRole('heading', { name: 'Signers (1)' })).toBeVisible();
  await expect(signer.getByText('Alex Morgan(you)')).toBeVisible();
  await expect(signer.getByText(/Document ID: ST-/)).toBeVisible();

  // The real finalized PDF renders, with working page navigation and zoom.
  await expect(signer.getByRole('img', { name: 'Page 1 of 2' })).toBeVisible({ timeout: 15_000 });
  await expect(signer.getByText('Page 1 of 2', { exact: true })).toBeVisible();
  await signer.getByRole('button', { name: 'Next page' }).click();
  await expect(signer.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await signer.getByRole('button', { name: 'Fit page' }).click();
  await expect(signer.getByRole('button', { name: 'Fit page' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await signer.getByRole('button', { name: 'Zoom in' }).click();
  await expect(signer.getByRole('button', { name: 'Fit page' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  const href = await signer
    .getByRole('toolbar')
    .getByRole('link', { name: 'Download' })
    .getAttribute('href');
  const dl = await signer.request.get(href!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-disposition']).toContain('attachment');
  expect((await dl.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Evidence certificate.
  await signer.getByRole('link', { name: 'View Evidence Certificate' }).click();
  await expect(signer.getByRole('heading', { name: 'Evidence certificate' })).toBeVisible();
  await expect(signer.getByRole('heading', { name: 'Integrity references' })).toBeVisible();
  await signer.getByRole('link', { name: 'Back to the signed document' }).click();

  // Another browser with only the document id gets nothing; the link alone is not enough for files
  // of someone else's request either.
  const stranger = await (await browser.newContext()).newPage();
  const res = await stranger.request.get(`/api/sign/${'B'.repeat(43)}/completed?kind=signed`);
  expect(res.status()).toBe(404);

  // "I'll do this later" is a link; it hides the offer, keeps the document, and stays hidden.
  const later = signer.getByRole('link', { name: "I'll do this later" });
  await expect(later).toBeVisible();
  await later.click();
  await expect(
    signer.getByRole('heading', { name: 'Manage Your Documents with Signature Tender' }),
  ).toBeHidden();
  await expect(signer.getByRole('button', { name: 'Create an account anytime.' })).toBeVisible();
  await expect(signer.getByRole('toolbar').getByRole('link', { name: 'Download' })).toBeVisible();
  await signer.reload();
  await expect(signer.getByRole('button', { name: 'Create an account anytime.' })).toBeVisible();

  // Create an account: the verified address is prefilled, then verify, claim, welcome.
  await signer.getByRole('button', { name: 'Create an account anytime.' }).click();
  await expect(signer.getByRole('heading', { name: 'Create your free account' })).toBeVisible();
  await expect(signer.getByLabel('Email')).toHaveValue(email);
  await signer.getByLabel('Full name').fill('Alex Morgan');
  await signer.getByLabel('Password').fill('correct-horse-battery-staple');
  await signer.getByRole('button', { name: 'Create account' }).click();
  await expect(signer.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await signer.goto(await latestLinkFor(email, 'Verify your email'));
  await expect(
    signer.getByRole('heading', { name: 'Add your signed document to your account?' }),
  ).toBeVisible();
  await expect(signer.getByText('Service Agreement', { exact: true })).toBeVisible();
  await signer.getByRole('button', { name: 'Add to My Documents' }).click();
  await expect(signer.getByRole('heading', { name: 'Welcome to Signature Tender!' })).toBeVisible();
  await expect(signer.getByText('Your signed document is ready in your workspace.')).toBeVisible();
  await expect(signer.getByRole('heading', { name: 'Documents Signed by Me' })).toBeVisible();

  const claimedDl = await signer.request.get(
    (await signer.getByRole('link', { name: 'Download' }).getAttribute('href'))!,
  );
  expect(claimedDl.status()).toBe(200);
  await signer.getByRole('link', { name: 'View Document' }).click();
  await expect(signer.getByRole('heading', { name: 'This Document Is Completed' })).toBeVisible();
  await expect(signer.getByRole('heading', { name: 'Manage Your Agreements' })).toBeVisible();
  await expect(signer.getByRole('button', { name: 'Create Free Account' })).toHaveCount(0);
  await expect(signer.getByRole('img', { name: 'Page 1 of 2' })).toBeVisible({ timeout: 15_000 });

  // The claim gave access to this one request only, and not to the sender's workspace.
  await signer.goto('/app/documents');
  await expect(signer).toHaveURL(/\/onboarding/);
});

test('an email-code signer re-verifies by email before the completed document opens', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const email = `rae-${Date.now()}@example.test`;
  const { signer, token } = await sendAndSign(page, browser, {
    email,
    name: 'Rae Signer',
    emailCode: true,
  });

  // The signing session ends at completion, so the page asks for a code sent to that address.
  await signer.goto(`/sign/completed/${token}`);
  await expect(signer.getByRole('heading', { name: "Confirm it's you" })).toBeVisible();
  const before = await signer.request.get(`/api/sign/${token}/completed?kind=signed`);
  expect(before.status()).toBe(401);
  await signer.getByRole('button', { name: 'Email me a code' }).click();
  const mail = await latestMail(email, 'Your document access code');
  await signer.getByLabel('6-digit code').fill(mail.subject.match(/(\d{6})/)![1]!);
  await signer.getByRole('button', { name: 'Verify and open the document' }).click();
  await expect(signer.getByRole('heading', { name: 'This Document Is Completed' })).toBeVisible();
  await expect(signer.getByRole('button', { name: 'Create Free Account' })).toBeVisible();
  await expect(signer.getByRole('img', { name: 'Page 1 of 2' })).toBeVisible({ timeout: 15_000 });
});
