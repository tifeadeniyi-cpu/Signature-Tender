import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor } from './mail';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

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
  await page.getByRole('button', { name: /Add your signature/ }).click();
  await page.getByRole('button', { name: 'Adopt and use signature' }).click();
  await page.getByRole('button', { name: 'Finish signing' }).click();
  await page.getByLabel(/intend to sign it electronically/).check();
  await page.getByRole('button', { name: 'Sign document' }).click();
  await expect(page.getByRole('heading', { name: 'This document is complete' })).toBeVisible({
    timeout: 20_000,
  });
}

test('the drawer opens from a row, switches tabs, reminds, deep-links and closes', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await signUpWithWorkspace(page, 'Dana Drawer', 'Drawer Works');
  const email = `drawer-${Date.now()}@example.test`;
  const id = await sendTestRequest(page, 'Service Agreement.pdf', 'Alex Morgan', email);

  await page.goto('/app/documents');
  const row = page.locator(`tr[data-doc-id="${id}"]`);
  // Clicking the row (not a control in it) opens the drawer without leaving the list.
  await row.locator('td').nth(2).click();
  const drawer = page.getByRole('dialog', { name: 'Service Agreement' });
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/app/documents\\?selected=${id}$`));
  await expect(
    drawer.getByText('Status: In progress').filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(drawer.getByText(`#ST-${id.slice(0, 8).toUpperCase()}`)).toBeVisible();
  await expect(drawer.getByText('0 of 1 completed')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Send Reminder' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Cancel Request' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Download Signed Document' })).toHaveCount(0);

  // The whole open drawer passes the accessibility scan.
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(TAGS).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);

  // Tabs: arrow keys move between them; each panel shows live data.
  await drawer.getByRole('tab', { name: 'Overview' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(drawer.getByRole('tab', { name: 'Signers' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(drawer.getByText(email)).toBeVisible();
  await expect(drawer.getByText('Signer', { exact: true })).toBeVisible();
  await drawer.getByRole('tab', { name: 'Activity' }).click();
  await expect(drawer.getByText('Request sent')).toBeVisible();
  await drawer.getByRole('tab', { name: 'Files' }).click();
  await expect(drawer.locator('p', { hasText: /^Original upload$/ })).toBeVisible();
  await expect(drawer.getByText('Signed document')).toHaveCount(0);
  const view = await drawer
    .getByRole('link', { name: /View Original upload/ })
    .getAttribute('href');
  expect((await page.request.get(view!)).status()).toBe(200);
  await drawer.getByRole('tab', { name: 'Evidence' }).click();
  await expect(drawer.getByText('SHA-256 fingerprints recorded')).toBeVisible();
  await expect(drawer.getByRole('link', { name: /View Evidence Certificate/ })).toHaveCount(0);

  // Reminder goes out once; a second within the hour is refused by the server.
  await drawer.getByRole('tab', { name: 'Overview' }).click();
  await drawer.getByRole('button', { name: 'Send Reminder' }).click();
  await expect(drawer.getByText('Reminder sent to Alex Morgan.')).toBeVisible();
  await drawer.getByRole('tab', { name: 'Signers' }).click();
  await expect(drawer.getByText('Reminders')).toBeVisible();
  await drawer.getByRole('button', { name: 'Send reminder' }).click();
  await expect(drawer.getByText(/A reminder was sent in the last hour/)).toBeVisible();

  // Escape closes and returns focus to the row's link; the URL forgets the selection.
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\/documents$/);
  await expect(row.getByRole('link', { name: 'Service Agreement', exact: true })).toBeFocused();

  // A deep link reopens it after a refresh; the close button works too.
  await page.goto(`/app/documents?selected=${id}`);
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Close document details' }).click();
  await expect(drawer).toHaveCount(0);

  // Focus stays inside while open.
  await row.getByRole('link', { name: 'View Service Agreement' }).click();
  await expect(drawer).toBeVisible();
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  // The signer finishes: the drawer offers the signed copy and the evidence certificate.
  const signer = await (await browser.newContext()).newPage();
  await sign(signer, await latestLinkFor(email, 'Please sign'));
  await page.goto(`/app/documents?selected=${id}`);
  await expect(
    drawer.getByText('Status: Completed').filter({ visible: true }).first(),
  ).toBeVisible();
  const dl = drawer.getByRole('link', { name: 'Download Signed Document' });
  await expect(dl).toBeVisible();
  const res = await page.request.get((await dl.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(drawer.getByRole('button', { name: 'Send Reminder' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Cancel Request' })).toHaveCount(0);
  await drawer.getByRole('tab', { name: 'Evidence' }).click();
  await expect(drawer.getByText('1 of 1').first()).toBeVisible();
  const cert = await drawer
    .getByRole('link', { name: 'Download Evidence Certificate' })
    .getAttribute('href');
  expect((await page.request.get(cert!)).status()).toBe(200);
  await drawer.getByRole('tab', { name: 'Files' }).click();
  await expect(drawer.locator('p', { hasText: /^Signed document$/ })).toBeVisible();
  await expect(drawer.locator('p', { hasText: /^Evidence certificate$/ })).toBeVisible();

  // The short reference finds the document in search.
  await page.goto(`/app/documents?q=ST-${id.slice(0, 8).toUpperCase()}`);
  await expect(page.getByRole('link', { name: 'Service Agreement', exact: true })).toBeVisible();

  // Opening another document swaps the content rather than stacking drawers.
  await upload(page, 'Vendor NDA.pdf');
  await page.goto(`/app/documents?selected=${id}`);
  await expect(drawer).toBeVisible();
  await page
    .getByRole('link', { name: 'Vendor NDA', exact: true })
    .evaluate((el: HTMLElement) => el.click());
  const nda = page.getByRole('dialog', { name: 'Vendor NDA' });
  await expect(nda).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(nda.getByText('Status: Draft').filter({ visible: true }).first()).toBeVisible();
  await expect(nda.getByRole('link', { name: 'Continue editing' })).toBeVisible();
  await expect(nda.getByRole('link', { name: 'Download Signed Document' })).toHaveCount(0);
});

test('loading, error and retry states, and cancelling from the drawer', async ({ page }) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Lou Loader', 'Loader Co');
  const id = await sendTestRequest(
    page,
    'Consulting.pdf',
    'Taylor Smith',
    `t-${Date.now()}@example.test`,
  );
  await page.goto('/app/documents');

  // Slow response: skeletons and a screen-reader status show while it loads.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`**/api/documents/${id}/summary`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('link', { name: 'Consulting', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await expect(
    drawer.getByRole('status').filter({ hasText: 'Loading document details' }),
  ).toBeAttached();
  await expect(drawer.getByRole('tab', { name: 'Signers' })).toBeDisabled();
  release();
  await expect(page.getByRole('dialog', { name: 'Consulting' })).toBeVisible();
  await page.unroute(`**/api/documents/${id}/summary`);

  // Failure: a clear message and a retry that keeps the drawer open.
  await page.keyboard.press('Escape');
  await page.route(`**/api/documents/${id}/summary`, (route) =>
    route.fulfill({ status: 500, json: { error: 'Something went wrong. Please try again.' } }),
  );
  await page.getByRole('link', { name: 'Consulting', exact: true }).click();
  await expect(drawer.getByText('Something went wrong. Please try again.')).toBeVisible();
  await page.unroute(`**/api/documents/${id}/summary`);
  await drawer.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('dialog', { name: 'Consulting' })).toBeVisible();

  // Cancel with a reason; the drawer and the list both update.
  await drawer.getByRole('button', { name: 'Cancel Request' }).click();
  await drawer.getByLabel(/Reason/).fill('Wrong version');
  await drawer.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(
    drawer.getByText('Status: Cancelled').filter({ visible: true }).first(),
  ).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Edit and send again' })).toBeVisible();
  await drawer.getByRole('tab', { name: 'Activity' }).click();
  await expect(drawer.getByText('Reason: Wrong version')).toBeVisible();
});

test('another workspace and signed-out visitors cannot read the drawer data', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Pat Private', 'Private Co');
  const id = await upload(page, 'Employment Contract.pdf');
  const own = await page.request.get(`/api/documents/${id}/summary`);
  expect(own.status()).toBe(200);
  expect(own.headers()['cache-control']).toContain('no-store');

  const other = await browser.newPage();
  await signUpWithWorkspace(other, 'Owen Outsider', 'Outside Co');
  expect((await other.request.get(`/api/documents/${id}/summary`)).status()).toBe(404);
  await other.goto(`/app/documents?selected=${id}`);
  await expect(other.getByRole('dialog').getByText(/not available/)).toBeVisible();
  await expect(other.getByText('Employment Contract')).toHaveCount(0);

  const anon = await (await browser.newContext()).request.get(`/api/documents/${id}/summary`);
  expect(anon.status()).toBe(401);
  const junk = await page.request.get('/api/documents/not-a-uuid/summary');
  expect(junk.status()).toBe(404);
});

test('on a phone the drawer fills the screen', async ({ page }) => {
  test.setTimeout(90_000);
  await signUpWithWorkspace(page, 'Mo Mobile', 'Mobile Co');
  await upload(page, 'Partnership.pdf');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/documents');
  await page.getByRole('link', { name: 'Partnership', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Partnership' });
  await expect(drawer).toBeVisible();
  await expect
    .poll(async () => (await drawer.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(389);
  const close = await drawer.getByRole('button', { name: 'Close document details' }).boundingBox();
  expect(close!.height).toBeGreaterThanOrEqual(40);
  const btn = await drawer.getByRole('link', { name: 'Continue editing' }).boundingBox();
  expect(btn!.height).toBeGreaterThanOrEqual(44);
});
