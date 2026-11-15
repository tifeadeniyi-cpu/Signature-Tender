import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  MemoryStorage,
  CONNECTORS,
  getConnector,
  resolveAvailability,
  registerConnectorForTests,
  deriveIntegrationKeys,
  beginOAuth,
  verifyOAuthState,
  buildAuthorizeUrl,
  pkceChallenge,
  exchangeCode,
  refreshTokens,
  sanitizeMetadata,
  sanitizeText,
  assertCanConnect,
  completeOAuthConnection,
  listIntegrationConnections,
  getAccessToken,
  testIntegrationConnection,
  disconnectIntegrationConnection,
  enqueueIntegrationJob,
  runIntegrationJobs,
  retryIntegrationJob,
  listIntegrationActivity,
  createAutomation,
  listAutomations,
  linkExternalRecord,
  listMappingsForDocument,
  setIntegrationAvailability,
  getIntegrationAdminOverview,
  connectIntegration,
  disconnectIntegration,
  deriveSecretsKey,
  IntegrationError,
  type ConnectorDefinition,
  type IntegrationContext,
  type OAuthConfig,
  type TokenSet,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const keys = deriveIntegrationKeys('k'.repeat(40));

// ---------------------------------------------------------------------------------------------
// A fake provider: OAuth endpoints and an API answered by an in-memory fetch.

const FAKE: OAuthConfig = {
  type: 'oauth2',
  authorizeUrl: 'https://auth.fake.test/authorize',
  tokenUrl: 'https://auth.fake.test/token',
  revokeUrl: 'https://auth.fake.test/revoke',
  scopes: ['files.read', 'files.write'],
  pkce: true,
  clientAuth: 'body',
  apiHosts: ['api.fake.test'],
};

const fakeDef: ConnectorDefinition = {
  key: 'fake_drive',
  name: 'Fake Drive',
  provider: 'Fake',
  category: 'Documents & Storage',
  description: 'Test connector',
  roadmapPhase: 1,
  availability: 'available',
  implemented: true,
  capabilities: ['save_signed'],
  auth: FAKE,
  access: { reads: [], writes: [], copiesSignedDocuments: true, revoke: '' },
  triggers: [],
  actions: [
    { key: 'fake.save', label: 'Save', description: 'Save', runsOn: ['request.completed'] },
  ],
  setup: [],
  logo: null,
  allowsPersonal: true,
};

interface FakeState {
  apiStatus: number;
  saves: string[];
  revoked: string[];
  tokenCalls: URLSearchParams[];
  refreshError?: string;
}
const fake: FakeState = { apiStatus: 200, saves: [], revoked: [], tokenCalls: [] };

let tokenSeq = 0;
const fakeFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const u = new URL(url);
  if (u.hostname === 'auth.fake.test' && u.pathname === '/token') {
    const body = new URLSearchParams(String(init.body));
    fake.tokenCalls.push(body);
    if (body.get('grant_type') === 'refresh_token' && fake.refreshError)
      return Response.json({ error: fake.refreshError }, { status: 400 });
    tokenSeq++;
    return Response.json({
      access_token: `access-${tokenSeq}`,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'files.read files.write',
      ...(body.get('grant_type') === 'authorization_code'
        ? { refresh_token: `refresh-${tokenSeq}` }
        : {}),
    });
  }
  if (u.hostname === 'auth.fake.test' && u.pathname === '/revoke') {
    fake.revoked.push(new URLSearchParams(String(init.body)).get('token') ?? '');
    return new Response(null, { status: 200 });
  }
  if (u.hostname === 'api.fake.test') {
    const auth = new Headers(init.headers).get('authorization') ?? '';
    if (!auth.startsWith('Bearer access-')) return new Response(null, { status: 401 });
    if (u.pathname === '/me') return Response.json({ id: 'acct-1', email: 'me@fake.test' });
    if (fake.apiStatus !== 200)
      return new Response(null, { status: fake.apiStatus, headers: { 'retry-after': '1' } });
    fake.saves.push(u.pathname);
    return Response.json({ id: `file-${fake.saves.length}` });
  }
  throw new Error(`unexpected fetch ${url}`);
};

let nowMs = Date.now();
const ctx: IntegrationContext = {
  keys,
  oauthClient: (p) => (p === 'fake_drive' ? { clientId: 'cid', clientSecret: 'csecret' } : null),
  featureEnabled: true,
  fetch: fakeFetch,
  now: () => nowMs,
};

let unregister: () => void;
let owner: string, manager: string, editor: string, viewer: string, outsider: string;
let ws: string, otherWs: string;

async function tokens(): Promise<TokenSet> {
  return exchangeCode(
    FAKE,
    { clientId: 'cid', clientSecret: 'csecret' },
    {
      code: 'c',
      redirectUri: 'https://app.test/cb',
      verifier: 'v'.repeat(50),
    },
    fakeFetch,
    nowMs,
  );
}

beforeAll(async () => {
  unregister = registerConnectorForTests(fakeDef, {
    async fetchAccount(call) {
      const r = await call('https://api.fake.test/me');
      const j = (await r.json()) as { id: string; email: string };
      return { id: j.id, label: j.email };
    },
    actions: {
      async 'fake.save'(a) {
        const r = await a.call(`https://api.fake.test/save/${a.requestId ?? 'none'}`, {
          method: 'POST',
        });
        const j = (await r.json()) as { id: string };
        return { externalReference: j.id, output: { fileId: j.id, access_token: 'leak?' } };
      },
    },
  });
  owner = await makeUser('int_owner');
  manager = await makeUser('int_manager');
  editor = await makeUser('int_editor');
  viewer = await makeUser('int_viewer');
  outsider = await makeUser('int_outsider');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Integrations WS' })).id;
  otherWs = (await createWorkspace(db, { userId: outsider }, { name: 'Other WS' })).id;
  await addMember(ws, manager, 'manager');
  await addMember(ws, editor, 'editor');
  await addMember(ws, viewer, 'viewer');
});
afterAll(async () => {
  unregister();
  await close();
  await owner_.close();
});

describe('catalogue and availability', () => {
  it('lists all 20 roadmap targets plus the working partner apps, with unbuilt ones locked', () => {
    const keysList = CONNECTORS.map((c) => c.key);
    for (const k of [
      'zapier',
      'google_drive',
      'hubspot',
      'make',
      'pipedrive',
      'jotform',
      'onedrive',
      'outlook',
      'salesforce',
      'sharepoint',
      'power_automate',
      'shopify',
      'woocommerce',
      'monday',
      'clickup',
      'asana',
      'dropbox',
      'box',
      'n8n',
      'zoho_crm',
      'beam_artist',
      'jectstack',
      'slack',
    ])
      expect(keysList).toContain(k);
    for (const k of ['zapier', 'google_drive', 'hubspot', 'make', 'salesforce']) {
      const r = resolveAvailability(
        getConnector(k)!,
        { [k]: 'available' },
        {
          oauthClient: () => ({ clientId: 'x', clientSecret: 'y' }),
          featureEnabled: true,
        },
      );
      expect(r).toEqual({ availability: 'coming_soon', connectable: false, reason: 'not_built' });
    }
  });

  it('needs provider credentials and the feature flag, and honours admin pauses', () => {
    const none = { oauthClient: () => null, featureEnabled: true };
    expect(resolveAvailability(fakeDef, {}, none).reason).toBe('setup_required');
    expect(resolveAvailability(fakeDef, {}, { ...ctx, featureEnabled: false }).reason).toBe(
      'feature_off',
    );
    expect(resolveAvailability(fakeDef, { fake_drive: 'maintenance' }, ctx)).toMatchObject({
      availability: 'maintenance',
      connectable: false,
    });
    expect(resolveAvailability(fakeDef, {}, ctx)).toMatchObject({ connectable: true });
    expect(resolveAvailability(getConnector('slack')!, {}, none).connectable).toBe(true);
  });
});

describe('OAuth state and PKCE', () => {
  const base = {
    provider: 'fake_drive',
    workspaceId: 'w',
    userId: 'u',
    visibility: 'workspace' as const,
    returnTo: '/app/integrations',
  };

  it('builds an authorize URL with state and an S256 challenge', () => {
    const { state } = beginOAuth(base, FAKE, keys.stateKey);
    const url = new URL(buildAuthorizeUrl(FAKE, { clientId: 'cid' }, 'https://app.test/cb', state));
    expect(url.searchParams.get('state')).toBe(state.state);
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(state.verifier!));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('files.read files.write');
    expect(url.toString()).not.toContain('csecret');
  });

  it('accepts only the matching, unexpired state for the same user and provider', () => {
    const { state, cookie } = beginOAuth(base, FAKE, keys.stateKey, 1000);
    expect(
      verifyOAuthState(
        cookie,
        state.state,
        { provider: 'fake_drive', userId: 'u' },
        keys.stateKey,
        2000,
      ).verifier,
    ).toBe(state.verifier);
    const bad = (fn: () => unknown) => expect(fn).toThrow(IntegrationError);
    bad(() =>
      verifyOAuthState(
        cookie,
        'x'.repeat(43),
        { provider: 'fake_drive', userId: 'u' },
        keys.stateKey,
        2000,
      ),
    );
    bad(() =>
      verifyOAuthState(
        cookie,
        state.state,
        { provider: 'fake_drive', userId: 'other' },
        keys.stateKey,
        2000,
      ),
    );
    bad(() =>
      verifyOAuthState(
        cookie,
        state.state,
        { provider: 'hubspot', userId: 'u' },
        keys.stateKey,
        2000,
      ),
    );
    bad(() =>
      verifyOAuthState(
        cookie,
        state.state,
        { provider: 'fake_drive', userId: 'u' },
        keys.stateKey,
        1000 + 11 * 60_000,
      ),
    );
    bad(() =>
      verifyOAuthState(
        cookie.slice(0, -3) + 'AAA',
        state.state,
        { provider: 'fake_drive', userId: 'u' },
        keys.stateKey,
        2000,
      ),
    );
    bad(() =>
      verifyOAuthState(
        undefined,
        state.state,
        { provider: 'fake_drive', userId: 'u' },
        keys.stateKey,
        2000,
      ),
    );
    bad(() =>
      verifyOAuthState(
        cookie,
        state.state,
        { provider: 'fake_drive', userId: 'u' },
        deriveIntegrationKeys('z'.repeat(40)).stateKey,
        2000,
      ),
    );
  });

  it('exchanges the code with the verifier and keeps the refresh token on refresh', async () => {
    fake.tokenCalls = [];
    const t = await tokens();
    expect(fake.tokenCalls[0]!.get('code_verifier')).toBe('v'.repeat(50));
    expect(fake.tokenCalls[0]!.get('client_secret')).toBe('csecret');
    expect(t.refreshToken).toMatch(/^refresh-/);
    const r = await refreshTokens(
      FAKE,
      { clientId: 'cid', clientSecret: 'csecret' },
      t.refreshToken!,
      fakeFetch,
    );
    expect(r.refreshToken).toBe(t.refreshToken);
    fake.refreshError = 'invalid_grant';
    await expect(
      refreshTokens(FAKE, { clientId: 'cid', clientSecret: 'csecret' }, 'r', fakeFetch),
    ).rejects.toMatchObject({ code: 'auth_expired' });
    fake.refreshError = undefined;
  });
});

describe('log sanitising', () => {
  it('drops secrets, tokens, emails and contents', () => {
    const m = sanitizeMetadata({
      fileId: 'f1',
      access_token: 'abc',
      refreshToken: 'def',
      authorization: 'Bearer x',
      email: 'a@b.com',
      content: 'PDF',
      nested: { apiKey: 'k', ok: 1, note: 'mail me at a@b.com' },
    });
    expect(m).toEqual({ fileId: 'f1', nested: { ok: 1, note: 'mail me at [email]' } });
    expect(sanitizeText('Bearer abc.def-ghi failed for x@y.io')).toBe(
      'Bearer [redacted] failed for [email]',
    );
  });
});

describe('connections', () => {
  let connId: string;

  it('only lets permitted members start a connection', async () => {
    await expect(
      assertCanConnect(db, { userId: viewer }, ws, 'fake_drive', 'workspace', ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      assertCanConnect(db, { userId: editor }, ws, 'fake_drive', 'workspace', ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      assertCanConnect(db, { userId: editor }, ws, 'fake_drive', 'personal', ctx),
    ).resolves.toBeTruthy();
    await expect(
      assertCanConnect(db, { userId: owner }, ws, 'google_drive', 'workspace', ctx),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      assertCanConnect(db, { userId: outsider }, ws, 'fake_drive', 'personal', ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('stores the connection with encrypted tokens and reconnects without duplicating', async () => {
    const r = await completeOAuthConnection(
      db,
      { userId: owner },
      { workspaceId: ws, provider: 'fake_drive', visibility: 'workspace', tokens: await tokens() },
      ctx,
    );
    expect(r).toMatchObject({
      account: { id: 'acct-1', label: 'me@fake.test' },
      reconnected: false,
    });
    connId = r.connectionId;
    const [cred] = await owner_.db
      .select()
      .from(schema.integrationCredentials)
      .where(eq(schema.integrationCredentials.connectionId, connId));
    expect(cred!.sealedAccessToken).toMatch(/^v1\./);
    expect(cred!.sealedAccessToken).not.toContain('access-');
    const again = await completeOAuthConnection(
      db,
      { userId: owner },
      { workspaceId: ws, provider: 'fake_drive', visibility: 'workspace', tokens: await tokens() },
      ctx,
    );
    expect(again).toMatchObject({ connectionId: connId, reconnected: true });
    const list = await listIntegrationConnections(db, { userId: manager }, ws);
    expect(list.filter((c) => c.provider === 'fake_drive')).toHaveLength(1);
    expect(list[0]).toMatchObject({
      status: 'active',
      externalAccountLabel: 'me@fake.test',
      visibility: 'workspace',
    });
    expect(JSON.stringify(list)).not.toContain('access-');
  });

  it('keeps personal connections private and blocks other workspaces', async () => {
    const p = await completeOAuthConnection(
      db,
      { userId: editor },
      { workspaceId: ws, provider: 'fake_drive', visibility: 'personal', tokens: await tokens() },
      ctx,
    );
    expect(p.connectionId).not.toBe(connId);
    const forViewer = await listIntegrationConnections(db, { userId: viewer }, ws);
    expect(forViewer.map((c) => c.id)).not.toContain(p.connectionId);
    expect(
      (await listIntegrationConnections(db, { userId: owner }, ws)).map((c) => c.id),
    ).toContain(p.connectionId);
    expect(await listIntegrationConnections(db, { userId: outsider }, ws)).toEqual([]);
    // Members who cannot use a connection cannot read its tokens, even in their own workspace.
    await expect(getAccessToken(db, { userId: viewer }, connId, ctx)).rejects.toBeTruthy();
    await expect(getAccessToken(db, { userId: outsider }, connId, ctx)).rejects.toBeTruthy();
    await expect(getAccessToken(db, { userId: manager }, p.connectionId, ctx)).rejects.toBeTruthy();
    // Members with "use" can.
    expect((await getAccessToken(db, { userId: editor }, connId, ctx)).token).toMatch(/^access-/);
    await disconnectIntegrationConnection(db, { userId: editor }, p.connectionId, ctx);
  });

  it('refreshes an expiring token and marks the connection expired when refresh is refused', async () => {
    const before = (await getAccessToken(db, { userId: owner }, connId, ctx)).token;
    nowMs += 2 * 3600_000;
    const after = (await getAccessToken(db, { userId: owner }, connId, ctx)).token;
    expect(after).not.toBe(before);
    nowMs += 2 * 3600_000;
    fake.refreshError = 'invalid_grant';
    await expect(getAccessToken(db, { userId: owner }, connId, ctx)).rejects.toMatchObject({
      code: 'auth_expired',
    });
    fake.refreshError = undefined;
    const [c] = await listIntegrationConnections(db, { userId: owner }, ws).then((l) =>
      l.filter((x) => x.id === connId),
    );
    expect(c).toMatchObject({ status: 'expired', lastErrorCode: 'auth_expired' });
    // Reconnecting restores it.
    await completeOAuthConnection(
      db,
      { userId: owner },
      { workspaceId: ws, provider: 'fake_drive', visibility: 'workspace', tokens: await tokens() },
      ctx,
    );
    const test = await testIntegrationConnection(db, { userId: owner }, connId, ctx);
    expect(test.ok).toBe(true);
  });

  it('jobs are idempotent, retry with backoff, and never log secrets', async () => {
    const a = await enqueueIntegrationJob(
      db,
      { userId: editor },
      { workspaceId: ws, connectionId: connId, operation: 'fake.save', idempotencyKey: 'manual:1' },
    );
    const b = await enqueueIntegrationJob(
      db,
      { userId: editor },
      { workspaceId: ws, connectionId: connId, operation: 'fake.save', idempotencyKey: 'manual:1' },
    );
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    await expect(
      enqueueIntegrationJob(
        db,
        { userId: viewer },
        {
          workspaceId: ws,
          connectionId: connId,
          operation: 'fake.save',
          idempotencyKey: 'manual:2',
        },
      ),
    ).rejects.toBeTruthy();
    await expect(
      enqueueIntegrationJob(
        db,
        { userId: editor },
        { workspaceId: ws, connectionId: connId, operation: 'nope', idempotencyKey: 'manual:3' },
      ),
    ).rejects.toMatchObject({ code: 'invalid' });

    fake.apiStatus = 503;
    fake.saves = [];
    expect(await runIntegrationJobs(db, ctx)).toMatchObject({ claimed: 1, retrying: 1 });
    const [j1] = await owner_.db
      .select()
      .from(schema.integrationSyncJobs)
      .where(eq(schema.integrationSyncJobs.id, a.id));
    expect(j1).toMatchObject({
      status: 'retrying',
      attemptCount: 1,
      errorCode: 'provider_unavailable',
    });
    expect(j1!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await runIntegrationJobs(db, ctx)).toMatchObject({ claimed: 0 });

    fake.apiStatus = 200;
    await owner_.db
      .update(schema.integrationSyncJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.integrationSyncJobs.id, a.id));
    expect(await runIntegrationJobs(db, ctx)).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(fake.saves).toHaveLength(1);
    const [j2] = await owner_.db
      .select()
      .from(schema.integrationSyncJobs)
      .where(eq(schema.integrationSyncJobs.id, a.id));
    expect(j2).toMatchObject({ status: 'succeeded', attemptCount: 2 });
    expect(j2!.output).toEqual({ fileId: 'file-1' });
    // Running again does nothing more.
    expect(await runIntegrationJobs(db, ctx)).toMatchObject({ claimed: 0 });

    const logs = await listIntegrationActivity(db, { userId: owner }, ws, { connectionId: connId });
    expect(logs.map((l) => l.status)).toEqual(
      expect.arrayContaining(['pending', 'retrying', 'success']),
    );
    expect(JSON.stringify(logs)).not.toMatch(/access-|refresh-|csecret|leak/);
    // The viewer has no log permission and did nothing: sees nothing.
    expect(await listIntegrationActivity(db, { userId: viewer }, ws)).toEqual([]);
    // The editor sees only their own entries.
    const own = await listIntegrationActivity(db, { userId: editor }, ws);
    expect(own.length).toBeGreaterThan(0);
  });

  it('fails permanently after the attempt limit, marks 401 as expired, and allows a manual retry', async () => {
    const j = await enqueueIntegrationJob(
      db,
      { userId: owner },
      {
        workspaceId: ws,
        connectionId: connId,
        operation: 'fake.save',
        idempotencyKey: 'manual:limit',
        maxAttempts: 1,
      },
    );
    fake.apiStatus = 503;
    expect(await runIntegrationJobs(db, ctx)).toMatchObject({ failed: 1 });
    fake.apiStatus = 401;
    await retryIntegrationJob(db, { userId: owner }, j.id);
    await expect(retryIntegrationJob(db, { userId: editor }, j.id)).rejects.toBeTruthy();
    expect(await runIntegrationJobs(db, ctx)).toMatchObject({ failed: 1 });
    const [c] = (await listIntegrationConnections(db, { userId: owner }, ws)).filter(
      (x) => x.id === connId,
    );
    expect(c).toMatchObject({ status: 'expired', lastErrorCode: 'auth_expired' });
    fake.apiStatus = 200;
    await completeOAuthConnection(
      db,
      { userId: owner },
      { workspaceId: ws, provider: 'fake_drive', visibility: 'workspace', tokens: await tokens() },
      ctx,
    );
  });

  it('automations queue exactly one job per matching event', async () => {
    await expect(
      createAutomation(db, { userId: editor }, ws, {
        connectionId: connId,
        name: 'Save',
        eventType: 'request.completed',
        action: 'fake.save',
      }),
    ).rejects.toBeTruthy();
    await expect(
      createAutomation(db, { userId: owner }, ws, {
        connectionId: connId,
        name: 'Save',
        eventType: 'request.sent',
        action: 'fake.save',
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const id = await createAutomation(db, { userId: owner }, ws, {
      connectionId: connId,
      name: 'Save signed',
      eventType: 'request.completed',
      action: 'fake.save',
      configuration: { folder: 'Contracts' },
    });
    const emit = async (type: string, workspaceId = ws) => {
      const [e] = await owner_.db
        .insert(schema.webhookEvents)
        .values({ workspaceId, type, data: { request_id: crypto.randomUUID() } })
        .returning();
      return e!.id;
    };
    const ev = await emit('request.completed');
    await emit('request.sent');
    await emit('request.completed', otherWs);
    const jobs = await owner_.db
      .select()
      .from(schema.integrationSyncJobs)
      .where(eq(schema.integrationSyncJobs.subscriptionId, id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      correlationId: ev,
      actorUserId: owner,
      operation: 'fake.save',
      requestId: null,
    });
    expect(await runIntegrationJobs(db, ctx)).toMatchObject({ succeeded: 1 });
    const [a] = await listAutomations(db, { userId: owner }, ws);
    expect(a).toMatchObject({ runCount: 1, failureCount: 0, enabled: true });
  });

  it('links external records once per document', async () => {
    const { id: docId } = await createDocumentFromUpload(
      db,
      storage,
      { userId: owner },
      {
        workspaceId: ws,
        title: 'From Drive',
        documentType: 'other',
        filename: 'a.pdf',
        bytes: await makePdf(1),
      },
      { maxBytes: 5e6, maxPages: 10 },
    );
    // The editor can use the connection but cannot see the owner's document, so cannot link it.
    await expect(
      linkExternalRecord(
        db,
        { userId: editor },
        {
          connectionId: connId,
          externalObjectType: 'file',
          externalObjectId: 'drive-1',
          documentId: docId,
        },
      ),
    ).rejects.toBeTruthy();
    const m1 = await linkExternalRecord(
      db,
      { userId: owner },
      {
        connectionId: connId,
        externalObjectType: 'file',
        externalObjectId: 'drive-1',
        documentId: docId,
      },
    );
    const m2 = await linkExternalRecord(
      db,
      { userId: owner },
      {
        connectionId: connId,
        externalObjectType: 'file',
        externalObjectId: 'drive-1',
        documentId: docId,
        externalLabel: 'NDA.pdf',
      },
    );
    await linkExternalRecord(
      db,
      { userId: owner },
      {
        connectionId: connId,
        externalObjectType: 'deal',
        externalObjectId: 'd-9',
        documentId: docId,
      },
    );
    expect(m2).toBe(m1);
    const list = await listMappingsForDocument(db, { userId: owner }, docId);
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.externalObjectId === 'drive-1')?.externalLabel).toBe('NDA.pdf');
    // A document in another workspace cannot be linked.
    const { id: foreignDoc } = await createDocumentFromUpload(
      db,
      storage,
      { userId: outsider },
      {
        workspaceId: otherWs,
        title: 'X',
        documentType: 'other',
        filename: 'x.pdf',
        bytes: await makePdf(1),
      },
      { maxBytes: 5e6, maxPages: 10 },
    );
    await expect(
      linkExternalRecord(
        db,
        { userId: owner },
        {
          connectionId: connId,
          externalObjectType: 'file',
          externalObjectId: 'x',
          documentId: foreignDoc,
        },
      ),
    ).rejects.toBeTruthy();
  });

  it('disconnecting revokes at the provider, deletes tokens, stops automations and keeps history', async () => {
    await enqueueIntegrationJob(
      db,
      { userId: owner },
      {
        workspaceId: ws,
        connectionId: connId,
        operation: 'fake.save',
        idempotencyKey: 'manual:waiting',
      },
    );
    await expect(
      disconnectIntegrationConnection(db, { userId: editor }, connId, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
    fake.revoked = [];
    const r = await disconnectIntegrationConnection(db, { userId: owner }, connId, ctx);
    expect(r.revokedAtProvider).toBe(true);
    expect(fake.revoked[0]).toMatch(/^refresh-/);
    expect(
      await owner_.db
        .select()
        .from(schema.integrationCredentials)
        .where(eq(schema.integrationCredentials.connectionId, connId)),
    ).toEqual([]);
    const [a] = await listAutomations(db, { userId: owner }, ws);
    expect(a!.enabled).toBe(false);
    const waiting = await owner_.db
      .select()
      .from(schema.integrationSyncJobs)
      .where(
        sql`${schema.integrationSyncJobs.connectionId} = ${connId} and ${schema.integrationSyncJobs.status} in ('pending','retrying')`,
      );
    expect(waiting).toEqual([]);
    await expect(getAccessToken(db, { userId: owner }, connId, ctx)).rejects.toMatchObject({
      code: 'auth_expired',
    });
    expect(
      (await listIntegrationActivity(db, { userId: owner }, ws, { connectionId: connId })).length,
    ).toBeGreaterThan(3);
  });
});

describe('partner connections still work', () => {
  it('keeps one Beam Artist connection per workspace next to OAuth connections', async () => {
    const webhookCtx = {
      encKey: deriveSecretsKey('x'.repeat(40)),
      urlPolicy: { resolve: async () => ['93.184.216.34'] },
    };
    const res = await connectIntegration(
      db,
      { userId: owner },
      ws,
      { provider: 'beam_artist' },
      webhookCtx,
    );
    expect(res.apiKey).toBeTruthy();
    await expect(
      connectIntegration(db, { userId: owner }, ws, { provider: 'beam_artist' }, webhookCtx),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      connectIntegration(db, { userId: owner }, ws, { provider: 'google_drive' }, webhookCtx),
    ).rejects.toMatchObject({ code: 'invalid' });
    await disconnectIntegration(db, { userId: owner }, ws, 'beam_artist');
    await connectIntegration(db, { userId: owner }, ws, { provider: 'beam_artist' }, webhookCtx);
  });
});

describe('staff controls', () => {
  it('only platform staff can change availability or see the overview', async () => {
    await expect(
      setIntegrationAvailability(db, { userId: owner }, 'slack', 'maintenance'),
    ).rejects.toBeTruthy();
    await expect(getIntegrationAdminOverview(db, { userId: owner })).rejects.toBeTruthy();
    await owner_.db.insert(schema.platformAdmins).values({ userId: manager }).onConflictDoNothing();
    await setIntegrationAvailability(db, { userId: manager }, 'slack', 'maintenance');
    const [cfg] = await owner_.db
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, 'integrations.availability'));
    expect(cfg!.value).toMatchObject({ slack: 'maintenance' });
    await setIntegrationAvailability(db, { userId: manager }, 'slack', null);
    const overview = await getIntegrationAdminOverview(db, { userId: manager });
    expect(overview.find((r) => r.provider === 'fake_drive')!.connections).toBeGreaterThanOrEqual(
      2,
    );
    expect(JSON.stringify(overview)).not.toMatch(/access-|refresh-|@/);
  });
});
