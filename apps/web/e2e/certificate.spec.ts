import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor } from './mail';

const OWNER =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';

async function makePdf(text: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

async function upload(page: Page, filename: string) {
  await page.goto('/app/documents/new');
  await page.getByLabel('PDF file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: await makePdf(filename),
  });
  await page.getByLabel('Document type').selectOption('agreement');
  await page.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(page).toHaveURL(/signers$/);
  return page.url().split('/documents/')[1]!.split('/')[0]!;
}

/** Uploads a PDF, adds one signer with one signature field, and sends a free test request. */
async function sendTestRequest(page: Page, filename: string, signerName: string, email: string) {
  const id = await upload(page, filename);
  await page.getByLabel('Full name').first().fill(signerName);
  await page.getByLabel('Email', { exact: true }).first().fill(email);
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/fields$/);
  await page.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/review$/);
  await page.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(page.getByText('Marked ready to send.')).toBeVisible();
  await page.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await page.getByRole('button', { name: 'Send test request' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients' })).toBeVisible();
  return id;
}

async function sign(page: Page, link: string) {
  await page.goto(link);
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

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('completion produces a certificate, a verifiable package, and public verification', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signUpWithWorkspace(page, 'Taylor Smith', 'Acme Corp');
  const email = `jordan-${Date.now()}@example.test`;
  const id = await sendTestRequest(page, 'Service Agreement.pdf', 'Jordan Lee', email);

  // Nothing to verify or download before completion.
  await page.goto(`/app/documents/${id}`);
  await expect(page.getByRole('link', { name: 'Download complete package' })).toHaveCount(0);

  const signer = await (await browser.newContext()).newPage();
  const signLink = await latestLinkFor(email, 'Please sign');
  await sign(signer, signLink);

  await page.goto(`/app/documents/${id}`);
  const certId = (await page
    .locator('dd', { hasText: /^CERT-\d{4}-\d{6}$/ })
    .textContent())!.trim();
  const ref = (await page
    .getByRole('link', { name: /^STV-[0-9A-Z]{4}-[0-9A-Z]{4}$/ })
    .textContent())!.trim();

  // Three downloads: package = agreement pages + certificate pages, in that order.
  const get = async (name: string) => {
    const href = await page.getByRole('link', { name, exact: true }).getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('no-store');
    return Buffer.from(await res.body());
  };
  const pkg = await get('Download complete package');
  const signed = await get('Download signed copy');
  const cert = await get('Download certificate');
  const pages = async (b: Buffer) => (await PDFDocument.load(b)).getPageCount();
  expect(await pages(pkg)).toBe((await pages(signed)) + (await pages(cert)));
  expect((await PDFDocument.load(cert)).getTitle()).toContain('Certificate of Completion');
  // The package is rebuilt identically on every download.
  expect(sha(await get('Download complete package'))).toBe(sha(pkg));

  // Stored identifiers and hashes match what was downloaded; the signed copy did not change.
  const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<
      { certificate_number: string; package_sha256: string; signed_sha: string; cert_sha: string }[]
    >`
      select r.certificate_number, r.package_sha256, sf.sha256 as signed_sha, cf.sha256 as cert_sha
      from signing_requests r
      join document_files sf on sf.id = r.signed_file_id
      join document_files cf on cf.id = r.certificate_file_id
      where r.verification_ref = ${ref}`;
    expect(row!.certificate_number).toBe(certId);
    expect(row!.package_sha256).toBe(sha(pkg));
    expect(row!.signed_sha).toBe(sha(signed));
    expect(row!.cert_sha).toBe(sha(cert));
  } finally {
    await sql.end();
  }

  // Public verification: no sign-in, minimal facts, no names or emails.
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`/verify?ref=${ref.toLowerCase()}`);
  await expect(anon.getByText('Reference found')).toBeVisible();
  await expect(anon.getByText(certId)).toBeVisible();
  await expect(anon.getByText('No certificate-based digital signature')).toBeVisible();
  await expect(anon.getByText('Identity not independently verified')).toBeVisible();
  const body = await anon.locator('main').innerText();
  expect(body).not.toContain('Jordan Lee');
  expect(body).not.toContain(email);
  expect(body).not.toContain('Service Agreement');

  // Hash check: the package matches; a changed copy does not. The file stays in the browser.
  const input = anon.getByLabel('PDF file');
  await input.setInputFiles({ name: 'pkg.pdf', mimeType: 'application/pdf', buffer: pkg });
  await expect(anon.getByText('Document hash matches')).toBeVisible();
  await expect(anon.getByText(/complete package/)).toBeVisible();
  await anon.getByRole('button', { name: 'Check another file' }).click();
  const tampered = Buffer.concat([pkg, Buffer.from('\n% changed')]);
  await input.setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: tampered });
  await expect(anon.getByText('Document hash does not match')).toBeVisible();

  await anon.goto('/verify?ref=STV-0000-0000');
  await expect(anon.getByText('Reference not found')).toBeVisible();
  await anon.goto('/verify?ref=nonsense');
  await expect(anon.getByText('does not look like a verification reference')).toBeVisible();

  // The completed page views the package and can jump to the certificate.
  await signer.goto(signLink);
  await signer.getByRole('link', { name: 'View completed document' }).click();
  await expect(signer.getByRole('button', { name: 'View Certificate of Completion' })).toBeVisible({
    timeout: 20_000,
  });
  await signer.getByRole('button', { name: 'View Certificate of Completion' }).click();
  const total = await pages(pkg);
  await expect(signer.getByText(`Page ${(await pages(signed)) + 1} of ${total}`)).toBeVisible();
});

test('staff re-issue gives an old completed request the new certificate without touching the agreement', async ({
  page,
  browser,
}) => {
  test.setTimeout(400_000);
  const ownerEmail = await signUpWithWorkspace(page, 'Casey Brooks', 'Brooks Studio');
  const email = `alex-${Date.now()}@example.test`;
  const id = await sendTestRequest(page, 'Vendor NDA.pdf', 'Alex Morgan', email);
  const signer = await (await browser.newContext()).newPage();
  await sign(signer, await latestLinkFor(email, 'Please sign'));

  const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
  try {
    // Make it look like a request finished before this release: no number, reference or package hash.
    const [before] = await sql<
      { id: string; signed_file_id: string; certificate_file_id: string }[]
    >`
      update signing_requests set certificate_number = null, verification_ref = null,
        package_sha256 = null, certificate_issued_at = null
      where document_id = ${id} and status = 'completed'
      returning id, signed_file_id, certificate_file_id`;
    await sql`insert into platform_admins (user_id, note) select id, 'e2e' from "user" where email = ${ownerEmail}`;
    await sql`update "user" set two_factor_enabled = true where email = ${ownerEmail}`;

    await page.goto('/admin/operations');
    await expect(
      page.getByText(/requests? still ha(s|ve) an old-design certificate/),
    ).toBeVisible();
    await page.getByRole('button', { name: /Re-issue certificates/ }).click();
    const msg = page.getByText(/certificates? re-issued/);
    await expect(msg).toBeVisible({ timeout: 120_000 });
    await expect(msg).toContainText(/[1-9]\d* certificates? re-issued/);

    const [after] = await sql<
      {
        signed_file_id: string;
        certificate_file_id: string;
        certificate_number: string | null;
        verification_ref: string | null;
      }[]
    >`
      select signed_file_id, certificate_file_id, certificate_number, verification_ref
      from signing_requests where id = ${before!.id}`;
    expect(after!.signed_file_id).toBe(before!.signed_file_id);
    expect(after!.certificate_file_id).not.toBe(before!.certificate_file_id);
    expect(after!.certificate_number).toMatch(/^CERT-/);
    const old = await sql`select 1 from document_files where id = ${before!.certificate_file_id}`;
    expect(old).toHaveLength(1);
    const ev = await sql<{ data: { previousCertificateFileId: string } }[]>`
      select data from signing_events where request_id = ${before!.id} and type = 'request.certificate_reissued'`;
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data.previousCertificateFileId).toBe(before!.certificate_file_id);

    // The new certificate is what the owner downloads, and its reference verifies publicly.
    await page.goto(`/app/documents/${id}`);
    const href = await page
      .getByRole('link', { name: 'Download certificate', exact: true })
      .getAttribute('href');
    const cert = Buffer.from(await (await page.request.get(href!)).body());
    expect((await PDFDocument.load(cert)).getTitle()).toContain('Certificate of Completion');
    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/verify?ref=${after!.verification_ref}`);
    await expect(anon.getByText('Reference found')).toBeVisible();

    // Running again never re-issues the same request twice.
    await page.goto('/admin/operations');
    const again = page.getByRole('button', { name: /Re-issue certificates/ });
    if (await again.count()) {
      await again.click();
      await expect(page.getByText(/certificates? re-issued/)).toBeVisible({
        timeout: 30_000,
      });
    }
    const ev2 =
      await sql`select 1 from signing_events where request_id = ${before!.id} and type = 'request.certificate_reissued'`;
    expect(ev2).toHaveLength(1);

    // Customers cannot run it: the action and page are staff-only.
    await sql`delete from platform_admins where user_id in (select id from "user" where email = ${ownerEmail})`;
    const res = await page.goto('/admin/operations');
    expect(res?.status()).toBe(404);
  } finally {
    await sql`delete from platform_admins where user_id in (select id from "user" where email = ${ownerEmail})`;
    await sql.end();
  }
});
