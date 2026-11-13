import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';

/**
 * The iOS and Android app's API, called the way the Expo client does: sign in with the app's
 * expo-origin header, then send the session cookie in a Cookie header on every call.
 */

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

const PASSWORD = 'correct-horse-battery-staple';
const APP = { 'expo-origin': 'signaturetender://', 'content-type': 'application/json' };

test('the mobile app signs in, reads the board and drawer data, reminds and cancels', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const email = await signUpWithWorkspace(page, 'Mo Bile', 'Pocket Works');
  const id = await sendTestRequest(
    page,
    'Phone Agreement.pdf',
    'Ada Signer',
    `ada-${Date.now()}@example.test`,
  );

  const anon = await pwRequest.newContext({ baseURL });
  // Signed out: nothing.
  expect((await anon.get('/api/mobile/me')).status()).toBe(401);
  // An unknown origin cannot use the app's sign-in.
  const evil = await anon.post('/api/auth/sign-in/email', {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    data: { email, password: PASSWORD },
  });
  expect(evil.status()).toBe(403);
  // The app's own scheme can.
  const signIn = await anon.post('/api/auth/sign-in/email', {
    headers: APP,
    data: { email, password: PASSWORD },
  });
  expect(signIn.status()).toBe(200);
  const cookie = signIn
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value.split(';')[0])
    .join('; ');
  expect(cookie).toContain('session_token');
  await anon.dispose();

  const app = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie, 'expo-origin': 'signaturetender://' },
  });
  const me = await (await app.get('/api/mobile/me')).json();
  expect(me).toMatchObject({
    user: { email, name: 'Mo Bile' },
    workspace: { name: 'Pocket Works' },
    can: { create: true, send: true },
  });

  const board = await (await app.get('/api/documents/board?limit=15')).json();
  expect(board.counts.sent).toBe(1);
  expect(board.cards[0]).toMatchObject({
    id,
    column: 'sent',
    actions: expect.arrayContaining(['send_reminder']),
  });
  const summary = await (await app.get(`/api/documents/${id}/summary`)).json();
  const rid = summary.requestId as string;
  expect(rid).toBeTruthy();

  // Changes must be JSON (a cross-site form cannot send that).
  const form = await app.post(`/api/mobile/requests/${rid}/remind`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: 'x=1',
  });
  expect(form.status()).toBe(422);
  const remind = await app.post(`/api/mobile/requests/${rid}/remind`, { headers: APP, data: {} });
  expect(remind.status()).toBe(200);
  expect((await remind.json()).message).toBe('Reminder sent to Ada Signer.');

  const cancel = await app.post(`/api/mobile/requests/${rid}/cancel`, {
    headers: APP,
    data: { reason: 'Sent the wrong version' },
  });
  expect(cancel.status()).toBe(200);
  const after = await (await app.get('/api/documents/board?limit=15')).json();
  expect(after.counts).toMatchObject({ sent: 0, cancelled: 1 });

  // Another person's session sees none of it.
  const outsider = await pwRequest.newContext({ baseURL });
  expect(
    (
      await outsider.post(`/api/mobile/requests/${rid}/remind`, { headers: APP, data: {} })
    ).status(),
  ).toBe(401);
  await outsider.dispose();
  await app.dispose();
});

test('universal link files stay empty until the app identifiers are configured', async ({
  request,
}) => {
  const aasa = await request.get('/.well-known/apple-app-site-association');
  expect(aasa.status()).toBe(404);
  const links = await request.get('/.well-known/assetlinks.json');
  expect(links.status()).toBe(200);
  expect(await links.json()).toEqual([]);
});
