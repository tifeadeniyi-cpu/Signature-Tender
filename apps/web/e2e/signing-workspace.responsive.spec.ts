import { test, expect, type Page, type Browser, type Locator } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor } from './mail';

/**
 * The recipient signing workspace end to end: open, review, navigate required fields, adopt a
 * styled typed signature, save and exit, resume, confirm intent, and submit. Runs on desktop and
 * on a phone (this file also matches the mobile project).
 */

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of ['Service Agreement', 'Exhibit A']) {
    doc.addPage([612, 792]).drawText(t, { x: 72, y: 700, size: 20, font });
  }
  return Buffer.from(await doc.save());
}

/** Sender (desktop UI) prepares a 2-page document: a signature on page 1, a text field on page 2. */
async function sendRequest(browser: Browser, signerEmail: string) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await signUpWithWorkspace(page, 'Jordan Lee', 'Lee Studio');
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Service Agreement.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/signers$/);
  await page.getByLabel('Full name').first().fill('Alex Morgan');
  await page.getByLabel('Email', { exact: true }).first().fill(signerEmail);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 2' }).click({ position: { x: 300, y: 600 } });
  await page.getByRole('radio', { name: 'Text' }).click();
  const p2 = page.getByRole('img', { name: 'Page 2 of 2' });
  await p2.scrollIntoViewIfNeeded();
  await p2.click({ position: { x: 200, y: 300 } });
  await page.getByLabel('Label').fill('Job title');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();
  await ctx.close();
  return latestLinkFor(signerEmail, 'Please sign');
}

async function enter(page: Page, link: string, consent: boolean) {
  await page.goto(link);
  await page.getByRole('button', { name: 'Start review' }).click();
  if (consent) {
    await expect(page.getByRole('heading', { name: 'Sign electronically' })).toBeVisible();
    await page.getByLabel('I agree to use electronic records').check();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Field navigation' })).toBeVisible();
}

/** The signing tools: the right column on desktop, the bottom sheet on a phone. */
function tools(page: Page, mobile: boolean): Locator {
  return mobile
    ? page.getByRole('dialog', { name: 'Signing tools' })
    : page.getByRole('complementary', { name: 'Signing tools' });
}

async function boxRelativeToPage(page: Page, field: Locator, pageNo: number) {
  const f = (await field.boundingBox())!;
  const p = (await page.getByRole('img', { name: `Page ${pageNo} of 2` }).boundingBox())!;
  return { x: (f.x - p.x) / p.width, y: (f.y - p.y) / p.height, w: f.width / p.width };
}

test('a recipient reviews, signs, saves, resumes and completes', async ({ browser, isMobile }) => {
  test.setTimeout(150_000);
  const email = `alex-${Date.now()}@example.test`;
  const link = await sendRequest(browser, email);
  const ctx = await browser.newContext(
    isMobile ? { ...test.info().project.use } : { viewport: { width: 1440, height: 900 } },
  );
  const page = await ctx.newPage();
  await enter(page, link, true);

  // Layout and document navigation.
  await expect(page.getByRole('navigation', { name: 'Signing progress' })).toBeVisible();
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByText('Page 1 of 2', { exact: true })).toBeVisible();
  if (!isMobile) {
    await expect(page.getByText('Document Pages (2)')).toBeVisible();
    await page.getByRole('button', { name: /Go to page 2/ }).click();
    await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  }

  // Zoom keeps fields anchored to the same spot on the page.
  const sigField = page.getByRole('button', { name: /^Sign here/ });
  await page.getByLabel('Zoom level').selectOption('100');
  await sigField.scrollIntoViewIfNeeded();
  const at100 = await boxRelativeToPage(page, sigField, 1);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByLabel('Zoom 125%')).toBeVisible();
  await sigField.scrollIntoViewIfNeeded();
  const at125 = await boxRelativeToPage(page, sigField, 1);
  expect(Math.abs(at100.x - at125.x)).toBeLessThan(0.01);
  expect(Math.abs(at100.y - at125.y)).toBeLessThan(0.01);
  expect(Math.abs(at100.w - at125.w)).toBeLessThan(0.01);
  await page.getByLabel('Zoom level').selectOption('width');

  // Required-field navigation and the Next Required Action.
  if (!isMobile) {
    await expect(tools(page, false).getByText('Add Your Signature').first()).toBeVisible();
    await expect(tools(page, false).getByText('0 of 2 completed')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next Field' }).click();
  await expect(sigField).toBeFocused();
  const studio = tools(page, isMobile);
  await expect(studio.getByRole('heading', { name: 'Signature Studio' })).toBeVisible();
  await expect(studio.getByLabel('Your full name')).toHaveValue('Alex Morgan');
  await studio.getByLabel('Style').selectOption({ label: 'Luxury Calligraphy' });
  await studio.getByRole('radio', { name: 'Variation 2' }).click();
  await studio.getByRole('button', { name: 'Customize Style' }).click();
  await studio.getByLabel('Ink').selectOption('burgundy');
  // The preview is exactly what will be adopted.
  const preview = await studio.getByAltText(/Preview of your signature/).getAttribute('src');
  await studio.getByRole('button', { name: 'Use This Signature' }).click();
  const applied = page.getByRole('button', { name: /^Signature applied/ });
  await expect(applied).toBeVisible();
  expect(await applied.locator('img').getAttribute('src')).toBe(preview);
  await expect(studio.getByText('1 of 2 completed')).toBeVisible();

  // Fill the text field (on a phone, in the bottom sheet's large input).
  await page.getByRole('button', { name: 'Next Field' }).click();
  if (isMobile) {
    await tools(page, true).getByLabel('Enter job title').fill('Creative Director');
  } else {
    await page.getByRole('textbox', { name: /^Job title \(required/ }).fill('Creative Director');
  }
  await expect(page.getByText('Saved', { exact: true }).first()).toBeAttached({ timeout: 10_000 });
  await expect(
    page
      .getByRole('navigation', { name: 'Field navigation' })
      .getByRole('button', { name: 'Finish Signing' }),
  ).toBeVisible();

  // Save & Exit ends the session without signing.
  if (isMobile) await page.getByRole('button', { name: 'Close signing tools' }).click();
  await page.getByRole('button', { name: 'Save & Exit' }).click();
  await expect(page.getByRole('heading', { name: 'Your progress is saved' })).toBeVisible();
  const anon = await ctx.request.get(`${link.replace('/sign/', '/api/sign/')}/file`);
  expect(anon.status()).not.toBe(200);

  // Resume: authenticate again; consent, values and the adopted signature are restored.
  await enter(page, link, false);
  await expect(page.getByRole('button', { name: /^Signature applied/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Job title/ }).first()).toHaveValue(
    'Creative Director',
  );

  // Finish requires explicit confirmation.
  await page
    .getByRole('navigation', { name: 'Field navigation' })
    .getByRole('button', { name: 'Finish Signing' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Confirm Your Electronic Signature' });
  await expect(confirm.getByText('Alex Morgan')).toBeVisible();
  await expect(confirm.getByText('2 of 2 complete')).toBeVisible();
  const complete = confirm.getByRole('button', { name: 'Complete Signing' });
  await expect(complete).toBeDisabled();
  await confirm.getByLabel(/intend to sign it electronically/).check();
  await complete.click();
  await expect(page.getByRole('heading', { name: "You've Completed Your Signing" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Alex Morgan')).toBeVisible();

  // The finished signer cannot reopen the workspace.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: "You've Completed Your Signing" })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Field navigation' })).toHaveCount(0);
  await ctx.close();
});
