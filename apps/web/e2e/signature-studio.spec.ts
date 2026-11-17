import { fileURLToPath as __toPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';
import { latestLinkFor } from './mail';

// Signature Studio: design as a guest, sign up, pay through the local Stripe stand-in (signed
// webhook), download the files, and check another account cannot reach them.
const __dirname = __toPath(new URL('.', import.meta.url));
const OWNER =
  process.env.TEST_DATABASE_URL_OWNER ??
  'postgres://st_owner:st_owner@localhost:5432/signature_tender_test';
const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
const SHOTS = process.env.STUDIO_SHOTS_DIR;

test.beforeAll(async () => {
  await sql`update feature_flags set enabled = true where key = 'payments'`;
  await sql`delete from app_config where key = 'signature_studio.settings'`;
});
test.afterAll(async () => {
  await sql`update feature_flags set enabled = false where key = 'payments'`;
  await sql.end();
});

async function shot(page: Page, name: string, locator?: string) {
  if (!SHOTS) return;
  await fs.mkdir(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  // The marketing header is sticky; keep it out of element screenshots.
  if (locator) {
    await page.addStyleTag({ content: 'header{position:static!important}' });
    await page.locator(locator).screenshot({ path: file });
  }
  else await page.screenshot({ path: file, fullPage: false });
}

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Booking Agreement', { x: 72, y: 700, size: 20, font });
  return Buffer.from(await doc.save());
}

async function drawStroke(page: Page, from: [number, number], to: [number, number], wobble = 6) {
  const canvas = page.getByRole('application');
  const box = (await canvas.boundingBox())!;
  const sx = box.width / 1200;
  const sy = box.height / 400;
  await page.mouse.move(box.x + from[0] * sx, box.y + from[1] * sy);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    const t = i / 30;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t + Math.sin(i * 0.9) * wobble;
    await page.mouse.move(box.x + x * sx, box.y + y * sy);
  }
  await page.mouse.up();
}

async function signUp(page: Page, name: string) {
  const email = `studio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await latestLinkFor(email, 'Verify your email'));
  return email;
}

test('design as a guest, sign up, pay $0.99 and download the files', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/signature-studio');
  await expect(page.getByRole('heading', { level: 1, name: 'Create Your Own Handwritten Signature' })).toBeVisible();
  await shot(page, '01-landing');
  await page.getByRole('link', { name: 'Design My Signature — Free Preview' }).click();
  await expect(page.getByRole('heading', { name: 'Try the Signature Studio' })).toBeVisible();

  // Type a name and choose a style family and variant.
  await page.getByLabel('Your name').fill('Jordan Lee');
  await page.getByRole('button', { name: /Luxury Flourish/ }).click();
  await expect(page.getByText('Luxury Flourish variations')).toBeVisible();
  await page.locator('#studio').scrollIntoViewIfNeeded();
  await shot(page, '02-editor-type-style', '#studio');

  // Font library: search and pick a font; the card shows the visitor's name.
  await page.getByRole('button', { name: 'Fonts', exact: true }).click();
  await page.getByLabel('Search fonts').fill('great');
  await page.getByRole('button', { name: 'Use Great Vibes' }).click();
  await shot(page, '03-font-library', '#studio');

  // Elements: add an underline from the library.
  await page.getByRole('button', { name: 'Signature Elements' }).click();
  await page.getByRole('button', { name: 'Add Long Sweeping Line' }).click();
  await expect(page.getByRole('heading', { name: 'Long Sweeping Line' })).toBeVisible();
  await page.getByRole('button', { name: 'Done editing element' }).click();

  // Smart Stroke: draw a stroke near the signature and refine it.
  await page.getByRole('button', { name: 'Draw on signature with Smart Stroke' }).click();
  await drawStroke(page, [760, 250], [1000, 215], 8);
  await expect(page.getByRole('heading', { name: 'Smart Stroke' })).toBeVisible();
  await page.getByRole('button', { name: 'Before' }).click();
  await shot(page, '04-smart-stroke-before', '#studio');
  await page.getByRole('button', { name: 'After' }).click();
  await page.getByRole('button', { name: 'Connect to Letter' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Connected|No letter/ })).toBeVisible();
  await shot(page, '05-smart-stroke-after', '#studio');
  await page.getByRole('button', { name: 'Apply' }).click();

  // Previews.
  await page.getByRole('button', { name: 'Dark navy' }).click();
  await shot(page, '06-preview-navy', '#studio');
  await page.getByRole('button', { name: 'Actual size' }).click();
  await expect(page.getByText('Shown at about the size it appears on a signed document.')).toBeVisible();
  await page.getByRole('button', { name: 'Actual size' }).click();
  await page.getByRole('button', { name: 'White paper' }).click();

  // Download asks a guest to sign in first; the draft is kept.
  await page.getByRole('button', { name: 'Sign In to Download — $0.99' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your Signature Is Ready' });
  await expect(dialog).toBeVisible();
  await shot(page, '07-auth-modal');
  await dialog.getByRole('link', { name: 'Create Free Account' }).click();
  await expect(page.getByText('Save your signature design and unlock it.')).toBeVisible();
  const buyerEmail = await signUp(page, 'Jordan Lee');

  // After verification the guest draft moved into the account and checkout opens.
  await expect(page.getByRole('heading', { name: 'Review your signature' })).toBeVisible();
  await expect(page.getByText('Total')).toBeVisible();
  await shot(page, '08-checkout');
  const designUrl = page.url();
  const designId = designUrl.split('/').pop()!;

  // Returning from Stripe without paying unlocks nothing.
  const blocked = await page.request.get(`/api/studio/download?d=${designId}&f=png&b=white&e=9999999999&s=${'0'.repeat(64)}`);
  expect(blocked.status()).toBe(403);

  await page.getByRole('button', { name: 'Pay $0.99 & Unlock' }).click();
  await expect(page.getByText('Custom Handwritten Signature: 0.99 USD')).toBeVisible();
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByRole('heading', { name: 'Your Custom Signature Is Ready' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Saved to Your Signature Library')).toBeVisible();
  await shot(page, '09-download-window');

  // Downloads: transparent PNG, true-vector SVG, JPG and a zip of all three.
  const dl = async (name: string) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
    const file = await download.path();
    return { name: download.suggestedFilename(), body: await fs.readFile(file!) };
  };
  const png = await dl('Download Transparent PNG');
  expect(png.name).toMatch(/\.png$/);
  expect(png.body.subarray(1, 4).toString()).toBe('PNG');
  expect(png.body[25]).toBe(6); // colour type 6: RGBA, so the background is transparent
  const svg = await dl('Download SVG');
  const text = svg.body.toString('utf8');
  expect(text.startsWith('<svg')).toBe(true);
  expect(text).not.toMatch(/<script|<text|<image|font-family|Jordan/);
  const jpg = await dl('Download JPG');
  expect(jpg.body[0]).toBe(0xff);
  const zip = await dl('Download All Formats');
  expect(zip.body.readUInt32LE(0)).toBe(0x04034b50);

  // Signed out, nothing downloads; signing in brings the buyer straight back to their files.
  const fresh = await browser.newContext();
  const out = await fresh.newPage();
  const noSession = await out.request.get(`/api/studio/download?d=${designId}&f=png&b=white&e=9999999999&s=${'0'.repeat(64)}`);
  expect(noSession.status()).toBe(401);
  await out.goto(`/signature-studio/design/${designId}`);
  await expect(out).toHaveURL(/\/sign-in\?next=/);
  // A new visitor's "Create an account" keeps the way back too.
  await expect(out.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
    'href',
    `/sign-up?next=${encodeURIComponent(`/signature-studio/design/${designId}`)}`,
  );
  await out.getByLabel('Email').fill(buyerEmail);
  await out.getByLabel('Password').fill('correct-horse-battery-staple');
  await out.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(out).toHaveURL(new RegExp(`/signature-studio/design/${designId}$`));
  await expect(out.getByRole('button', { name: 'Download Transparent PNG' })).toBeVisible();
  await fresh.close();

  // The library lists the purchase; editing it makes a new draft and never changes it.
  await page.goto('/signature-studio/library');
  await expect(page.getByRole('heading', { name: 'My Signatures' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Purchased' }).getByText('Jordan Lee')).toBeVisible();
  await shot(page, '10-library');

  // Signed-in users also get Signature Studio in the app menu.
  await page.goto('/app');
  if (page.url().includes('/onboarding')) {
    await page.getByLabel('Workspace name').fill('Lee Consulting');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/app$/);
  }
  await page.getByRole('navigation').getByRole('link', { name: 'Signature Studio' }).first().click();
  await expect(page).toHaveURL(/\/app\/signature-studio$/);
  await expect(page.getByRole('heading', { name: 'Signature Studio', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download — $0.99' })).toBeVisible();
  await shot(page, '11-app-menu');

  // Someone else cannot see the design or use a download link.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('/sign-up');
  await signUp(p2, 'Taylor Smith');
  const res = await p2.goto(`/signature-studio/design/${designId}`);
  expect(res?.status()).toBe(404);
  const denied = await p2.request.get(`/api/studio/download?d=${designId}&f=png&b=white&e=9999999999&s=${'0'.repeat(64)}`);
  expect(denied.status()).toBe(403);
  await other.close();

  // A purchased design can be used to sign a document sent to the buyer, at no extra fee.
  const sender = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(sender, 'Alex Morgan', 'Morgan Events');
  await sender.goto('/app/documents/new');
  await sender.getByLabel('PDF file').setInputFiles({ name: 'Booking.pdf', mimeType: 'application/pdf', buffer: await makePdf() });
  await sender.getByLabel('Document type').selectOption('agreement');
  await sender.getByRole('button', { name: 'Upload and continue' }).click();
  await expect(sender).toHaveURL(/signers$/);
  await sender.getByLabel('Full name').first().fill('Jordan Lee');
  await sender.getByLabel('Email', { exact: true }).first().fill(buyerEmail);
  await sender.getByRole('button', { name: 'Save and continue' }).click();
  await expect(sender).toHaveURL(/fields$/);
  await sender.getByRole('img', { name: 'Page 1 of 1' }).click({ position: { x: 200, y: 500 } });
  await sender.getByRole('button', { name: 'Save and continue' }).click();
  await sender.getByRole('button', { name: 'Save and continue' }).click();
  await expect(sender).toHaveURL(/review$/);
  await sender.getByRole('button', { name: 'Mark ready to send' }).click();
  await expect(sender.getByText('Marked ready to send.')).toBeVisible();
  await sender.getByRole('checkbox', { name: /This document is not one of these/ }).check();
  await sender.getByRole('button', { name: 'Send test request' }).click();
  await expect(sender.getByRole('heading', { name: 'Recipients' })).toBeVisible();
  await sender.context().close();

  await page.goto(await latestLinkFor(buyerEmail, 'Please sign'));
  await page.getByRole('button', { name: /^Review/ }).click();
  await expect(page.getByRole('heading', { name: 'Sign electronically' })).toBeVisible();
  await page.getByLabel('I agree to use electronic records').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Next Field' }).click();
  const tools = page.getByRole('complementary', { name: 'Signing tools' });
  await expect(tools.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');
  await expect(tools.getByText('My Signatures from Signature Studio. Using one adds no fee.')).toBeVisible();
  await shot(page, '14-use-in-signing');
  await tools.getByRole('button', { name: 'Use This Signature' }).click();
  await expect(page.getByText('1 of 1 completed')).toBeVisible();
  const [ev] = await sql`select data from signing_events where type = 'recipient.signature_adopted'
      and data->>'studioDesignId' = ${designId} limit 1`;
  expect(ev).toBeTruthy();

  // The purchase is recorded once, with an entitlement and stored files.
  const [row] = await sql`select p.payment_status, p.amount_cents, d.status,
      (select count(*)::int from signature_entitlements e where e.signature_design_id = d.id and e.access_status = 'active') as ents,
      (select count(*)::int from signature_assets a where a.signature_design_id = d.id and a.status = 'ready') as assets
    from signature_purchases p join signature_designs d on d.id = p.signature_design_id where d.id = ${designId}`;
  expect(row).toMatchObject({ payment_status: 'paid', amount_cents: 99, status: 'purchased', ents: 1 });
  expect(row!.assets).toBeGreaterThanOrEqual(3);
});

test('mobile: tools sit under the canvas and drawing does not scroll the page', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/signature-studio#studio');
  await page.getByLabel('Your name').fill('Alex Morgan');
  await page.getByRole('tab', { name: 'Draw Signature' }).click();
  const canvas = page.getByRole('application');
  await expect(canvas).toHaveCSS('touch-action', 'none');
  await canvas.scrollIntoViewIfNeeded();
  await shot(page, '12-mobile-draw');
  await page.getByRole('tab', { name: 'Type & Style' }).click();
  await page.getByRole('heading', { name: 'Signature styles', exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '13-mobile-styles');
  await ctx.close();
  void __dirname;
});
