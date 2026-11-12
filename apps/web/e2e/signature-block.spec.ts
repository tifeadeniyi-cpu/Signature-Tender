import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor } from './mail';

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Services Agreement', { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

test('sender picks the signature block, small fields are flagged, and the seal opens its details', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUpWithWorkspace(page, 'Bea Sender', 'Bea Studio');
  const signerEmail = `block-${Date.now()}@example.test`;

  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: 'Services.pdf',
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

  // The default signature field is big enough for the full block: no warning.
  const canvas = page.getByRole('img', { name: 'Page 1 of 1' });
  await canvas.click({ position: { x: 150, y: 450 } });
  const sigField = page.getByRole('button', { name: /Signature field for Alex Morgan/ });
  await expect(sigField).toBeVisible();
  await expect(page.getByLabel('Field is too small for the full signature block')).toHaveCount(0);
  // Shrink it with the keyboard-free resize handle: drag the corner up and left.
  const box = (await sigField.boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 5 });
  await page.mouse.up();
  await sigField.focus();
  await expect(page.getByLabel('Field is too small for the full signature block')).toBeVisible();
  await page.getByRole('button', { name: 'Enlarge field to fit' }).click();
  await expect(page.getByLabel('Field is too small for the full signature block')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // Settings: option D is the default; pick the time zone shown on the document.
  await expect(page).toHaveURL(/settings$/);
  await expect(
    page.getByRole('radio', { name: /D\. Signature, name, signing time and seal/ }),
  ).toBeChecked();
  await page.getByLabel('Time zone for signing times').selectOption('America/New_York');
  await page.screenshot({ path: 'test-results/signature-block-settings.png', fullPage: true });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();

  // Sign.
  const link = await latestLinkFor(signerEmail, 'Please sign');
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(link);
  await signer.getByRole('button', { name: 'Start review' }).click();
  await signer.getByLabel('I agree to use electronic records').check();
  await signer.getByRole('button', { name: 'Continue' }).click();
  await signer.getByRole('button', { name: /Add your signature/ }).click();
  const dialog = signer.getByRole('dialog', { name: 'Adopt your signature' });
  await dialog.getByRole('button', { name: 'Adopt and use signature' }).click();
  await expect(dialog).toBeHidden();
  await signer.getByRole('button', { name: /Finish signing/ }).click();
  await signer.getByLabel(/intend to sign it electronically/).check();
  await signer.getByRole('button', { name: 'Sign document' }).click();
  await expect(signer.getByRole('heading', { name: 'This document is complete' })).toBeVisible({
    timeout: 20_000,
  });

  // Sender: the signed copy carries the block; its seal opens the verification panel.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await page.getByRole('button', { name: 'Show signed copy' }).click();
  const hotspot = page.getByRole('button', { name: 'Signing details for Alex Morgan' });
  await expect(hotspot).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/signature-block-signed-copy.png', fullPage: true });
  await hotspot.click();
  const panel = page.getByRole('dialog', { name: 'Signing recorded' });
  await expect(panel.getByText('Alex Morgan', { exact: false })).toBeVisible();
  await expect(panel).toContainText(/at \d{1,2}:\d{2} (AM|PM) \((EST|EDT)\)/);
  await expect(panel).toContainText(/UTC/);
  await expect(panel).toContainText(/EV-\d+-[0-9A-F]{12}/);
  await expect(
    panel.getByText(/not mean the signer's identity was independently verified/),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Check now' }).click();
  await expect(panel.getByText(/Signed copy and evidence chain match their records/)).toBeVisible();
  await page.screenshot({ path: 'test-results/signature-block-panel.png' });
  await expect(
    panel.getByRole('link', { name: 'Open the completion certificate' }),
  ).toHaveAttribute('href', /kind=certificate/);
});
