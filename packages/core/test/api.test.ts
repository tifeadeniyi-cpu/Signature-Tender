import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  sendForSignature,
  cancelRequest,
  getSignerView,
  MemoryStorage,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  authenticateApiKey,
  requireScope,
  hitRateLimit,
  beginIdempotent,
  finishIdempotent,
  assertDocumentInWorkspace,
  assertRequestInWorkspace,
  setExternalRef,
  findByExternalRef,
  getRequestStatus,
  listRequestEvents,
  createEmbeddedSigningSession,
  remindRecipients,
  getUsage,
  deriveSecretsKey,
  encryptSecret,
  decryptSecret,
  validateWebhookUrl,
  isPrivateAddress,
  buildSignatureHeader,
  verifyWebhookSignature,
  createWebhookEndpoint,
  listWebhookEndpoints,
  rotateWebhookSecret,
  sendTestWebhook,
  retryWebhookDelivery,
  listWebhookDeliveries,
  dispatchWebhooks,
  INTEGRATIONS,
  connectIntegration,
  disconnectIntegration,
  listConnections,
  type ApiPrincipal,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const limits = { maxBytes: 5 * 1024 * 1024, maxPages: 100 };
const TEST = { mode: 'test' as const, testSigningEnabled: true };
const encKey = deriveSecretsKey('x'.repeat(40));
const publicResolve = async () => ['93.184.216.34'];
const ctx = { encKey, urlPolicy: { resolve: publicResolve } };

let owner: string, dev: string, viewer: string;
let ws: string, otherWs: string;

async function readyDoc(workspaceId: string, actorId = owner) {
  const actor = { userId: actorId };
  const { id } = await createDocumentFromUpload(
    db,
    storage,
    actor,
    {
      workspaceId,
      title: 'API Booking',
      documentType: 'booking',
      filename: 'a.pdf',
      bytes: await makePdf(1),
    },
    limits,
  );
  await saveRecipients(
    db,
    actor,
    id,
    {
      signingOrderEnabled: false,
      recipients: [
        {
          name: 'Ann',
          email: 'ann@example.test',
          role: 'signer',
          signingOrder: 1,
          authMethod: 'email_link',
        },
      ],
    },
    { maxSigners: 5 },
  );
  const d = await getDocument(db, actor, id);
  await saveFields(db, actor, id, [
    {
      recipientId: d.recipients[0]!.id,
      type: 'signature',
      page: 1,
      x: 0.1,
      y: 0.7,
      width: 0.3,
      height: 0.06,
    },
  ]);
  expect(await markReadyToSend(db, actor, id)).toEqual([]);
  return id;
}

beforeAll(async () => {
  owner = await makeUser('api_owner');
  dev = await makeUser('api_dev');
  viewer = await makeUser('api_viewer');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'API WS' })).id;
  otherWs = (await createWorkspace(db, { userId: owner }, { name: 'Other WS' })).id;
  await addMember(ws, dev, 'api_developer');
  await addMember(ws, viewer, 'viewer');
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('API keys', () => {
  it('creates a key shown once, stores only a hash, and authenticates it', async () => {
    const k = await createApiKey(db, { userId: owner }, ws, {
      name: 'Server',
      scopes: ['documents:read'],
    });
    expect(k.key).toMatch(/^stk_/);
    const [row] = await owner_.db
      .select()
      .from(schema.apiKeys)
      .where(sql`${schema.apiKeys.id} = ${k.id}`);
    expect(row!.keyHash).not.toContain(k.key);
    expect(JSON.stringify(row)).not.toContain(k.key);
    const p = await authenticateApiKey(db, k.key);
    expect(p).toMatchObject({
      workspaceId: ws,
      actor: { userId: owner },
      scopes: ['documents:read'],
    });
    expect(() => requireScope(p!, 'requests:send')).toThrow(/requests:send/);
    expect(await authenticateApiKey(db, k.key.slice(0, -1) + 'x')).toBeNull();
    expect(await authenticateApiKey(db, 'not-a-key')).toBeNull();
    const list = await listApiKeys(db, { userId: owner }, ws);
    expect(list.find((x) => x.id === k.id)?.prefix).toBe(k.prefix);
  });

  it('only lets members with api.manage create keys', async () => {
    await expect(
      createApiKey(db, { userId: viewer }, ws, { name: 'Nope', scopes: ['documents:read'] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      createApiKey(db, { userId: dev }, ws, { name: 'Dev', scopes: ['documents:read'] }),
    ).resolves.toBeTruthy();
  });

  it('stops working when revoked, and when its creator leaves', async () => {
    const k = await createApiKey(db, { userId: owner }, ws, {
      name: 'Temp',
      scopes: ['documents:read'],
    });
    await revokeApiKey(db, { userId: owner }, k.id);
    expect(await authenticateApiKey(db, k.key)).toBeNull();
    const d = await createApiKey(db, { userId: dev }, ws, {
      name: 'Dev 2',
      scopes: ['documents:read'],
    });
    expect(await authenticateApiKey(db, d.key)).not.toBeNull();
    await owner_.db.execute(
      sql`update workspace_memberships set status = 'suspended' where user_id = ${dev} and workspace_id = ${ws}`,
    );
    expect(await authenticateApiKey(db, d.key)).toBeNull();
    await owner_.db.execute(
      sql`update workspace_memberships set status = 'active' where user_id = ${dev} and workspace_id = ${ws}`,
    );
  });

  it('rotates: the new key works now and the old one expires within a day', async () => {
    const k = await createApiKey(db, { userId: owner }, ws, {
      name: 'Rotating',
      scopes: ['documents:read'],
    });
    const n = await rotateApiKey(db, { userId: owner }, k.id);
    expect(await authenticateApiKey(db, n.key)).not.toBeNull();
    expect(await authenticateApiKey(db, k.key)).not.toBeNull();
    const [row] = await owner_.db
      .select()
      .from(schema.apiKeys)
      .where(sql`${schema.apiKeys.id} = ${k.id}`);
    expect(row!.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000 + 1000);
    await owner_.db.execute(
      sql`update api_keys set expires_at = now() - interval '1 second' where id = ${k.id}`,
    );
    expect(await authenticateApiKey(db, k.key)).toBeNull();
  });

  it('rate limits per key per minute', async () => {
    const k = await createApiKey(db, { userId: owner }, ws, {
      name: 'Rate',
      scopes: ['documents:read'],
    });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit(db, k.id, 3));
    expect(results).toEqual([true, true, true, false]);
  });

  it('replays an idempotent response and rejects a different body under the same key', async () => {
    const k = await createApiKey(db, { userId: owner }, ws, {
      name: 'Idem',
      scopes: ['documents:read'],
    });
    expect(await beginIdempotent(db, k.id, 'idem-key-1', 'POST /x {a}')).toEqual({ state: 'new' });
    expect(await beginIdempotent(db, k.id, 'idem-key-1', 'POST /x {a}')).toEqual({
      state: 'in_progress',
    });
    await finishIdempotent(db, k.id, 'idem-key-1', 201, { id: 'abc' });
    expect(await beginIdempotent(db, k.id, 'idem-key-1', 'POST /x {a}')).toEqual({
      state: 'replay',
      status: 201,
      body: { id: 'abc' },
    });
    expect(await beginIdempotent(db, k.id, 'idem-key-1', 'POST /x {b}')).toEqual({
      state: 'mismatch',
    });
    // A server error frees the key so the client can retry.
    expect(await beginIdempotent(db, k.id, 'idem-key-2', 'P')).toEqual({ state: 'new' });
    await finishIdempotent(db, k.id, 'idem-key-2', 500, { error: 'x' });
    expect(await beginIdempotent(db, k.id, 'idem-key-2', 'P')).toEqual({ state: 'new' });
    await expect(beginIdempotent(db, k.id, 'bad key!', 'P')).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});

describe('API resources', () => {
  let p: ApiPrincipal;
  beforeAll(async () => {
    const k = await createApiKey(db, { userId: owner }, ws, {
      name: 'Full',
      scopes: [
        'documents:read',
        'documents:write',
        'requests:send',
        'embedded:sign',
        'billing:read',
      ],
    });
    p = (await authenticateApiKey(db, k.key))!;
  });

  it('keeps a key inside its workspace even when its member belongs to others', async () => {
    const mine = await readyDoc(ws);
    const theirs = await readyDoc(otherWs);
    await expect(assertDocumentInWorkspace(db, p, mine)).resolves.toBeUndefined();
    await expect(assertDocumentInWorkspace(db, p, theirs)).rejects.toMatchObject({
      code: 'not_found',
    });
    const { requestId } = await sendForSignature(db, storage, p.actor, theirs, TEST);
    await expect(assertRequestInWorkspace(db, p, requestId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('stores a partner reference and finds documents by it', async () => {
    const id = await readyDoc(ws);
    await setExternalRef(db, p.actor, id, {
      source: 'beam_artist',
      id: 'booking-42',
      metadata: { venue: 'Hall' },
    });
    const found = await findByExternalRef(db, p, 'beam_artist', 'booking-42');
    expect(found.map((d) => d.id)).toContain(id);
    expect(await findByExternalRef(db, p, 'beam_artist', 'nope')).toEqual([]);
    await expect(
      setExternalRef(db, p.actor, id, { source: 'Bad Source', id: 'x' }),
    ).rejects.toThrow();
  });

  it('reports status and evidence events, and emits webhook events from the database', async () => {
    const id = await readyDoc(ws);
    const { requestId, invitations } = await sendForSignature(db, storage, p.actor, id, TEST);
    const st = await getRequestStatus(db, p.actor, requestId);
    expect(st).toMatchObject({ id: requestId, status: 'sent', test: true });
    expect(st.recipients[0]).toMatchObject({ email: 'ann@example.test', status: 'notified' });
    await getSignerView(db, invitations[0]!.token, undefined);
    const ev = await listRequestEvents(db, p.actor, requestId);
    expect(ev.length).toBeGreaterThan(0);
    expect(JSON.stringify(ev)).not.toMatch(/ip_?address/i);
    const types = (
      (await owner_.db.execute(
        sql`select type from webhook_events where data->>'request_id' = ${requestId} order by created_at`,
      )) as unknown as { type: string }[]
    ).map((r) => r.type);
    expect(types).toEqual(
      expect.arrayContaining(['request.created', 'request.sent', 'recipient.viewed']),
    );
    await cancelRequest(db, p.actor, requestId, 'Changed plans');
    const after = (await owner_.db.execute(
      sql`select type from webhook_events where data->>'request_id' = ${requestId} and type = 'request.cancelled'`,
    )) as unknown as unknown[];
    expect(after).toHaveLength(1);
  });

  it('creates a short-lived embedded session that replaces the emailed link', async () => {
    const id = await readyDoc(ws);
    const { requestId, invitations } = await sendForSignature(db, storage, p.actor, id, TEST);
    const recipientId = invitations[0]!.recipientId;
    const s = await createEmbeddedSigningSession(db, p.actor, requestId, recipientId, {
      ttlMinutes: 15,
    });
    expect(s.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1000);
    await expect(getSignerView(db, s.token, undefined)).resolves.toBeTruthy();
    await expect(getSignerView(db, invitations[0]!.token, undefined)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      createEmbeddedSigningSession(db, { userId: viewer }, requestId, recipientId, {
        ttlMinutes: 15,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('reminds with fresh links at most once an hour', async () => {
    const id = await readyDoc(ws);
    const { requestId, invitations } = await sendForSignature(db, storage, p.actor, id, TEST);
    const r = await remindRecipients(db, p.actor, requestId);
    expect(r.invitations).toHaveLength(1);
    expect(r.invitations[0]!.token).not.toBe(invitations[0]!.token);
    await expect(remindRecipients(db, p.actor, requestId)).rejects.toMatchObject({
      code: 'rate_limited',
    });
    await expect(remindRecipients(db, { userId: viewer }, requestId)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('reports usage by month', async () => {
    const u = await getUsage(db, p, 3);
    expect(u.at(-1)!.test).toBeGreaterThan(0);
  });
});

describe('webhook security helpers', () => {
  it('encrypts secrets with authentication', () => {
    const sealed = encryptSecret('whsec_abc', encKey);
    expect(sealed).not.toContain('whsec_abc');
    expect(decryptSecret(sealed, encKey)).toBe('whsec_abc');
    expect(() => decryptSecret(sealed, deriveSecretsKey('y'.repeat(40)))).toThrow();
    expect(() => deriveSecretsKey('short')).toThrow();
  });

  it('blocks private, loopback and non-HTTPS destinations', async () => {
    for (const ip of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    await expect(
      validateWebhookUrl('http://example.com/h', { resolve: publicResolve }),
    ).rejects.toThrow(/https/);
    await expect(validateWebhookUrl('https://169.254.169.254/latest')).rejects.toThrow(/public/);
    await expect(
      validateWebhookUrl('https://internal.example/h', { resolve: async () => ['10.0.0.5'] }),
    ).rejects.toThrow(/public/);
    await expect(
      validateWebhookUrl('https://u:p@example.com/h', { resolve: publicResolve }),
    ).rejects.toThrow();
    await expect(
      validateWebhookUrl('https://example.com/h', { resolve: publicResolve }),
    ).resolves.toBeTruthy();
    await expect(
      validateWebhookUrl('http://localhost:4000/h', { allowLocalhost: true }),
    ).resolves.toBeTruthy();
    await expect(validateWebhookUrl('http://localhost:4000/h')).rejects.toThrow();
  });

  it('signs payloads that receivers can verify, and rejects stale or altered ones', () => {
    const t = Math.floor(Date.now() / 1000);
    const h = buildSignatureHeader(['whsec_new', 'whsec_old'], t, '{"a":1}');
    expect(verifyWebhookSignature('whsec_new', h, '{"a":1}')).toBe(true);
    expect(verifyWebhookSignature('whsec_old', h, '{"a":1}')).toBe(true);
    expect(verifyWebhookSignature('whsec_new', h, '{"a":2}')).toBe(false);
    expect(verifyWebhookSignature('whsec_other', h, '{"a":1}')).toBe(false);
    expect(verifyWebhookSignature('whsec_new', h, '{"a":1}', { now: t + 301 })).toBe(false);
    expect(verifyWebhookSignature('whsec_new', null, '{"a":1}')).toBe(false);
  });
});

describe('webhook delivery', () => {
  it('delivers signed events, retries with backoff, and supports manual retry', async () => {
    const { id: endpointId, secret } = await createWebhookEndpoint(
      db,
      { userId: owner },
      ws,
      { url: 'https://hooks.example.com/st', events: ['request.sent'] },
      ctx,
    );
    const [stored] = await owner_.db
      .select()
      .from(schema.webhookEndpoints)
      .where(sql`${schema.webhookEndpoints.id} = ${endpointId}`);
    expect(stored!.secretEncrypted).not.toContain(secret);
    await expect(
      createWebhookEndpoint(
        db,
        { userId: viewer },
        ws,
        { url: 'https://hooks.example.com/x' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    const id = await readyDoc(ws);
    const { requestId } = await sendForSignature(db, storage, { userId: owner }, id, TEST);

    const received: { headers: Headers; body: string }[] = [];
    let status = 500;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      received.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response('ok', { status });
    }) as unknown as typeof fetch;

    const first = await dispatchWebhooks(db, { ...ctx, fetch: fakeFetch });
    const mine = received.filter((r) => JSON.parse(r.body).data.request_id === requestId);
    expect(mine).toHaveLength(1);
    const body = JSON.parse(mine[0]!.body);
    expect(body).toMatchObject({ type: 'request.sent', workspace_id: ws });
    expect(body.data).not.toHaveProperty('pdf');
    expect(mine[0]!.headers.get('Signature-Tender-Event-Id')).toBe(body.id);
    expect(
      verifyWebhookSignature(
        secret,
        mine[0]!.headers.get('Signature-Tender-Signature'),
        mine[0]!.body,
      ),
    ).toBe(true);
    expect(first.failed).toBeGreaterThan(0);

    const [d] = await listWebhookDeliveries(db, { userId: owner }, ws, { endpointId });
    expect(d).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastStatusCode: 500,
      eventType: 'request.sent',
    });
    const wait = d!.nextAttemptAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(20_000);
    expect(wait).toBeLessThan(40_000);

    // Not due yet: nothing is sent.
    received.length = 0;
    await dispatchWebhooks(db, { ...ctx, fetch: fakeFetch });
    expect(received.filter((r) => JSON.parse(r.body).data.request_id === requestId)).toHaveLength(
      0,
    );

    // Manual retry makes it due now; this time the receiver accepts it.
    await expect(retryWebhookDelivery(db, { userId: viewer }, d!.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await retryWebhookDelivery(db, { userId: owner }, d!.id);
    status = 200;
    await dispatchWebhooks(db, { ...ctx, fetch: fakeFetch });
    const [done] = await listWebhookDeliveries(db, { userId: owner }, ws, { endpointId });
    expect(done).toMatchObject({ status: 'succeeded', lastStatusCode: 200 });

    // Rotation: both secrets sign for a day.
    const { secret: next } = await rotateWebhookSecret(db, { userId: owner }, endpointId, ctx);
    await sendTestWebhook(db, { userId: owner }, endpointId);
    received.length = 0;
    await dispatchWebhooks(db, { ...ctx, fetch: fakeFetch });
    const ping = received.find((r) => JSON.parse(r.body).type === 'webhook.test')!;
    const sig = ping.headers.get('Signature-Tender-Signature');
    expect(verifyWebhookSignature(next, sig, ping.body)).toBe(true);
    expect(verifyWebhookSignature(secret, sig, ping.body)).toBe(true);
    expect((await listWebhookEndpoints(db, { userId: owner }, ws)).length).toBeGreaterThan(0);
  });

  it('marks a delivery dead after the last attempt and never follows redirects', async () => {
    const { id: endpointId } = await createWebhookEndpoint(
      db,
      { userId: owner },
      otherWs,
      {
        url: 'https://redirect.example.com/st',
        events: ['webhook.test' as never].filter(Boolean) as never[],
      },
      ctx,
    ).catch(() =>
      createWebhookEndpoint(
        db,
        { userId: owner },
        otherWs,
        { url: 'https://redirect.example.com/st' },
        ctx,
      ),
    );
    await sendTestWebhook(db, { userId: owner }, endpointId);
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      expect(init.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/' } });
    }) as unknown as typeof fetch;
    await dispatchWebhooks(db, { ...ctx, fetch: fakeFetch, maxAttempts: 1 });
    const [d] = await listWebhookDeliveries(db, { userId: owner }, otherWs, { endpointId });
    expect(d).toMatchObject({ status: 'dead', lastStatusCode: 302 });
    expect(d!.lastError).toMatch(/Redirect/);
  });
});

describe('integrations', () => {
  it('only offers connectors that exist', () => {
    const live = INTEGRATIONS.filter((i) => i.available).map((i) => i.key);
    expect(live.sort()).toEqual(['beam_artist', 'jectstack']);
  });

  it('connects a partner with its own key and webhook, and disconnects cleanly', async () => {
    const res = await connectIntegration(
      db,
      { userId: dev },
      ws,
      { provider: 'beam_artist', webhookUrl: 'https://beam.example.com/hooks/st' },
      ctx,
    );
    expect(res.apiKey).toMatch(/^stk_/);
    expect(res.webhookSecret).toMatch(/^whsec_/);
    const p = await authenticateApiKey(db, res.apiKey);
    expect(p!.scopes).toContain('embedded:sign');
    expect(p!.scopes).not.toContain('billing:read');
    await expect(
      connectIntegration(db, { userId: dev }, ws, { provider: 'beam_artist' }, ctx),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      connectIntegration(db, { userId: dev }, ws, { provider: 'dropbox' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      connectIntegration(db, { userId: viewer }, ws, { provider: 'jectstack' }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const list = await listConnections(db, { userId: viewer }, ws);
    expect(list.find((c) => c.provider === 'beam_artist')?.status).toBe('active');

    await disconnectIntegration(db, { userId: dev }, ws, 'beam_artist');
    expect(await authenticateApiKey(db, res.apiKey)).toBeNull();
    const again = await listConnections(db, { userId: dev }, ws);
    expect(again.find((c) => c.provider === 'beam_artist')?.status).toBe('disabled');
    await expect(
      connectIntegration(db, { userId: dev }, ws, { provider: 'beam_artist' }, ctx),
    ).resolves.toMatchObject({ webhookSecret: null });
  });
});
