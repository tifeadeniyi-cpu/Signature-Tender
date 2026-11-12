import { test, expect } from '@playwright/test';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PDFDocument } from 'pdf-lib';
import { signUpWithWorkspace } from './auth';

async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

function verify(secret: string, header: string, body: string) {
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')![1]!;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return parts.some(([k, v]) => k === 'v1' && v === want);
}

test('a developer creates a key, sends a document through the API and receives a signed webhook', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const hookUrl = `http://localhost:${(server.address() as AddressInfo).port}/hook`;

  try {
    await signUpWithWorkspace(page, 'Dev Eloper', 'API Studio');
    await page.goto('/app/settings/developers');
    await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible();

    // Webhook endpoint first, so it receives the events that follow.
    await page.getByLabel('Endpoint URL').fill(hookUrl);
    await page.getByRole('button', { name: 'Add endpoint' }).click();
    const hookSecret = (await page
      .locator('code', { hasText: /^whsec_/ })
      .first()
      .textContent())!;
    expect(hookSecret).toMatch(/^whsec_/);

    await page.getByLabel('Key name').fill('E2E server');
    for (const s of ['documents:write', 'requests:send'])
      await page.getByRole('checkbox', { name: new RegExp(s) }).check();
    await page.getByRole('checkbox', { name: /documents:read/ }).uncheck();
    await page.getByRole('button', { name: 'Create key' }).click();
    const key = (await page.locator('code', { hasText: /^stk_/ }).first().textContent())!;
    expect(key).toMatch(/^stk_/);
    const auth = { authorization: `Bearer ${key}` };

    // No key, bad key.
    expect((await request.get('/api/v1/documents')).status()).toBe(401);
    const bad = await request.get('/api/v1/documents', {
      headers: { authorization: 'Bearer stk_nope_nope_nope_nope_nope_nope' },
    });
    expect(bad.status()).toBe(401);
    expect((await bad.json()).error.code).toBe('unauthenticated');

    const up = await request.post('/api/v1/documents', {
      headers: auth,
      multipart: {
        file: { name: 'deal.pdf', mimeType: 'application/pdf', buffer: await pdf() },
        title: 'API deal',
        external_source: 'beam_artist',
        external_id: 'booking-7',
      },
    });
    expect(up.status()).toBe(201);
    const doc = await up.json();
    expect(doc.external).toMatchObject({ source: 'beam_artist', id: 'booking-7' });

    const rec = await request.put(`/api/v1/documents/${doc.id}/recipients`, {
      headers: auth,
      data: { recipients: [{ name: 'Ann Lee', email: 'ann-api@example.test', role: 'signer' }] },
    });
    expect(rec.status()).toBe(200);
    const rid = (await rec.json()).recipients[0].id;

    const invalid = await request.put(`/api/v1/documents/${doc.id}/fields`, {
      headers: auth,
      data: {
        fields: [
          {
            recipient_id: rid,
            type: 'signature',
            page: 1,
            x: 0.9,
            y: 0.9,
            width: 0.3,
            height: 0.06,
          },
        ],
      },
    });
    expect(invalid.status()).toBe(422);

    expect(
      (
        await request.put(`/api/v1/documents/${doc.id}/fields`, {
          headers: auth,
          data: {
            fields: [
              {
                recipient_id: rid,
                type: 'signature',
                page: 1,
                x: 0.1,
                y: 0.8,
                width: 0.3,
                height: 0.06,
              },
            ],
          },
        })
      ).status(),
    ).toBe(200);

    const sendOpts = {
      headers: { ...auth, 'idempotency-key': 'e2e-send-0001' },
      data: { mode: 'test' },
    };
    const sent = await request.post(`/api/v1/documents/${doc.id}/send`, sendOpts);
    expect(sent.status()).toBe(201);
    const { request_id } = await sent.json();
    const replay = await request.post(`/api/v1/documents/${doc.id}/send`, sendOpts);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect((await replay.json()).request_id).toBe(request_id);

    // This key lacks documents:read.
    const st = await request.get(`/api/v1/requests/${request_id}`, { headers: auth });
    expect(st.status()).toBe(403);

    await expect
      .poll(
        () => received.filter((r) => JSON.parse(r.body).data?.request_id === request_id).length,
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(0);
    const hit = received.find((r) => JSON.parse(r.body).data?.request_id === request_id)!;
    expect(verify(hookSecret, String(hit.headers['signature-tender-signature']), hit.body)).toBe(
      true,
    );
    expect(JSON.parse(hit.body).data.external_id).toBe('booking-7');

    await page.reload();
    await expect(page.getByText('request.created').first()).toBeVisible();
  } finally {
    server.close();
  }
});

test('the integrations page only offers connectors that work', async ({ page }) => {
  await signUpWithWorkspace(page, 'Ivy Integrator', 'Partner Studio');
  await page.goto('/app/integrations');
  await expect(page.getByRole('heading', { name: 'Beam Artist' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jectstack' })).toBeVisible();
  const dropbox = page.getByRole('listitem').filter({ hasText: 'Dropbox' });
  await expect(dropbox.getByText('Not available yet')).toBeVisible();
  await expect(dropbox.getByRole('button')).toHaveCount(0);

  await page.getByRole('button', { name: 'Connect Beam Artist' }).click();
  await expect(page.locator('code', { hasText: /^stk_/ })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Connected, not used yet')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect Beam Artist' }).click();
  await expect(page.getByText('Not connected').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Beam Artist' })).toBeVisible();
});
