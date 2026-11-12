import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';

async function makePdf(pages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Test agreement page ${i + 1}`, { x: 72, y: 700, size: 18, font });
  }
  return Buffer.from(await doc.save());
}

test('upload, add signers, place fields, set options and mark ready', async ({ page }) => {
  await signUpWithWorkspace(page);
  await page.goto('/app/documents');
  await expect(page.getByRole('heading', { name: 'No documents yet' })).toBeVisible();
  await page.getByRole('link', { name: 'New document' }).first().click();

  // Wrong file type is refused before upload.
  await page
    .getByLabel('PDF file')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('Only PDF files can be uploaded.')).toBeVisible();

  // A file named .pdf that is not a PDF is refused by the server.
  await page.getByLabel('PDF file').setInputFiles({
    name: 'fake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not really a pdf'),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page.getByText('Only PDF files are supported.')).toBeVisible();

  await page.getByLabel('PDF file').setInputFiles({
    name: 'Studio Agreement.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(2),
  });
  await page.getByLabel('Document name').fill('Studio Agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/\/prepare\/signers$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Studio Agreement');

  // Signers: duplicate email is flagged, then fixed.
  await page.getByLabel('Full name').nth(0).fill('Ada Client');
  await page.getByLabel('Email', { exact: true }).nth(0).fill('ada@example.test');
  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.getByLabel('Full name').nth(1).fill('Ben Manager');
  await page.getByLabel('Email', { exact: true }).nth(1).fill('ADA@example.test');
  await expect(page.getByText('Already listed')).toHaveCount(2);
  await page.getByLabel('Email', { exact: true }).nth(1).fill('ben@example.test');
  await page.getByLabel('Role').nth(1).selectOption('cc');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/prepare\/fields$/);

  // Fields: only the signer is offered; place a signature on page 1.
  const select = page.getByLabel('Placing fields for');
  await expect(select.locator('option')).toHaveCount(1);
  await expect(page.getByText('Add a signature field for Ada Client.')).toBeVisible();
  const canvas = page.getByRole('img', { name: 'Page 1 of 2' });
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 200, y: 300 } });
  const field = page.getByRole('button', { name: /Signature field for Ada Client, page 1/ });
  await expect(field).toBeVisible();
  // A second click places another field even while the first is selected.
  await page.getByRole('radio', { name: 'Date signed' }).click();
  await canvas.click({ position: { x: 450, y: 300 } });
  await expect(page.getByText('2 fields placed')).toBeVisible();

  // Drag a text field from the palette onto page 2.
  const page2 = page.getByRole('img', { name: 'Page 2 of 2' });
  await page2.scrollIntoViewIfNeeded();
  const chip = page.getByRole('radio', { name: 'Text', exact: true });
  const cb = (await chip.boundingBox())!;
  const pb = (await page2.boundingBox())!;
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + 150, pb.y + 150, { steps: 8 });
  await page.mouse.move(pb.x + 200, pb.y + 200, { steps: 8 });
  await page.mouse.up();
  const textField = page.getByRole('button', { name: /Text field for Ada Client, page 2/ });
  await expect(textField).toBeVisible();
  const tb = (await textField.boundingBox())!;
  expect(Math.abs(tb.x + tb.width / 2 - (pb.x + 200))).toBeLessThan(4);
  expect(Math.abs(tb.y + tb.height / 2 - (pb.y + 200))).toBeLessThan(4);
  await expect(page.getByText('3 fields placed')).toBeVisible();

  // Delete it with the button on the selected field.
  await page.getByRole('button', { name: 'Delete text field' }).click();
  await expect(textField).toHaveCount(0);
  await expect(page.getByText('2 fields placed')).toBeVisible();

  // A placed field can be dragged onto another page.
  const dateField = page.getByRole('button', { name: /Date signed field for Ada Client, page 1/ });
  await dateField.scrollIntoViewIfNeeded();
  const db = (await dateField.boundingBox())!;
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await page.mouse.down();
  // Holding near the bottom edge scrolls the next page into view.
  const vh = page.viewportSize()!.height;
  await page.mouse.move(db.x + db.width / 2, vh - 10, { steps: 10 });
  await expect
    .poll(async () => (await page2.boundingBox())!.y, { timeout: 5000 })
    .toBeLessThan(vh / 2);
  const pb2 = (await page2.boundingBox())!;
  await page.mouse.move(pb2.x + 300, pb2.y + 100, { steps: 10 });
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: /Date signed field for Ada Client, page 2/ }),
  ).toBeVisible();

  await field.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/prepare\/settings$/);

  // Settings: reminders and a message.
  await page.getByLabel('Message to recipients (optional)').fill('Please sign by Friday.');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/prepare\/review$/);

  await expect(page.getByText('Everything needed is in place.')).toBeVisible();
  await expect(page.getByText('Please sign by Friday.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send test request' })).toBeDisabled();
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
  await expect(page.getByText('Ready to send').first()).toBeVisible();

  // Field persisted across reloads.
  await page.goto(page.url().replace('/review', '/fields'));
  await expect(
    page.getByRole('button', { name: /Signature field for Ada Client, page 1/ }),
  ).toBeVisible();

  // The original file is served only to authorized users.
  const id = page.url().split('/documents/')[1]!.split('/')[0]!;
  const res = await page.request.get(`/api/documents/${id}/file`);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('no-store');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');

  await page.goto('/app/documents');
  await expect(page.getByRole('link', { name: /^Studio Agreement/ })).toBeVisible();
});

test('another workspace cannot read the file or open the document', async ({ browser }) => {
  const a = await browser.newPage();
  await signUpWithWorkspace(a, 'Owner One', 'One Co');
  await a.goto('/app/documents/new');
  await a
    .getByLabel('PDF file')
    .setInputFiles({ name: 'Private.pdf', mimeType: 'application/pdf', buffer: await makePdf(1) });
  await a.getByLabel('Document type').selectOption('nda');
  await a.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(a).toHaveURL(/\/prepare\/signers$/);
  const id = a.url().split('/documents/')[1]!.split('/')[0]!;

  const b = await browser.newPage();
  await signUpWithWorkspace(b, 'Outsider Two', 'Two Co');
  const res = await b.request.get(`/api/documents/${id}/file`);
  expect(res.status()).toBe(404);
  await b.goto(`/app/documents/${id}/prepare/review`);
  await expect(b.getByText(/not found|could not be found|doesn.t exist/i).first()).toBeVisible();

  const anon = await browser.newContext();
  const r2 = await anon.request.get(
    `http://localhost:${process.env.E2E_PORT ?? 3100}/api/documents/${id}/file`,
  );
  expect(r2.status()).toBe(401);
});
