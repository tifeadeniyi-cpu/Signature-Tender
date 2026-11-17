import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';

/**
 * Files over the hosting limit (4.5 MB per request on Vercel) are sent in pieces and joined on the
 * server. A ~9 MB PDF must upload like any other.
 */
async function bigPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Large agreement', { x: 72, y: 700, size: 20, font });
  // Random bytes do not compress, so the file stays large.
  await doc.attach(randomBytes(9 * 1024 * 1024), 'exhibits.bin', {
    mimeType: 'application/octet-stream',
  });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

test('a PDF over 4.5 MB uploads in pieces and opens the next step', async ({ page }) => {
  test.setTimeout(120_000);
  await signUpWithWorkspace(page, 'Lara Large', 'Large Files Co');
  const pdf = await bigPdf();
  expect(pdf.length).toBeGreaterThan(8 * 1024 * 1024);

  const pieces: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/uploads/')) pieces.push(r.method());
  });
  await page.goto('/app/documents/new');
  await page
    .getByLabel('PDF file')
    .setInputFiles({ name: 'Big.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/\/prepare\/signers$/, { timeout: 60_000 });
  expect(pieces.length).toBe(Math.ceil(pdf.length / (4 * 1024 * 1024)));
  expect(new Set(pieces)).toEqual(new Set(['PUT']));
});

test('an upload with a missing piece is refused clearly, and pieces stay private', async ({
  page,
  browser,
}) => {
  await signUpWithWorkspace(page, 'Pia Pieces', 'Pieces Co');
  await page.goto('/app/documents/new');
  const res = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    await fetch(`/api/uploads/${id}/0`, { method: 'PUT', body: new Uint8Array(1024) });
    const r = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uploadId: id,
        parts: 2,
        filename: 'x.pdf',
        title: 'x',
        documentType: 'other',
      }),
    });
    return { status: r.status, body: await r.json() };
  });
  expect(res.status).toBe(422);
  expect(res.body.error).toBe('The upload did not finish. Please try again.');

  // Signed out: pieces are refused.
  const anon = await browser.newPage();
  await anon.goto('/');
  const status = await anon.evaluate(
    async () =>
      (
        await fetch(`/api/uploads/${crypto.randomUUID()}/0`, {
          method: 'PUT',
          body: new Uint8Array(10),
        })
      ).status,
  );
  expect(status).toBe(401);
  await anon.close();
});
