import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
  INTEGRATIONS,
  resolveAvailability,
  canConnect,
  connectionState,
  searchIntegrations,
  beginOAuth,
  completeOAuth,
  deriveSecretsKey,
  saveOAuthConnection,
  getConnection,
  getAccessToken,
  listConnections,
  importFromGoogleDrive,
  updateIntegrationSettings,
  disconnectOAuthIntegration,
  listIntegrationActivity,
  retryIntegrationJob,
  runIntegrationJobs,
  connectIntegration,
  driveFileName,
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  sendForSignature,
  startSigning,
  getSignerView,
  giveConsent,
  getSigningWorkspace,
  adoptSignature,
  completeSigning,
  finalizeRequest,
  MemoryStorage,
  type IntegrationRuntime,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { addMember, makePdf, makeUser } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const encKey = deriveSecretsKey('integration-test-secret-0123456789abcdef');
const LIMITS = { maxBytes: 5 * 1024 * 1024, maxPages: 20 };
let owner: string, viewer: string, outsider: string, ws: string, otherWs: string;

/** A small in-memory stand-in for Google's OAuth and Drive endpoints. */
class FakeGoogle {
  files = new Map<
    string,
    {
      id: string;
      name: string;
      mimeType: string;
      parents?: string[];
      appProperties?: Record<string, string>;
      bytes?: Uint8Array;
      trashed?: boolean;
    }
  >();
  refreshes = 0;
  revoked: string[] = [];
  refreshFails = false;
  uploadFailsOnce = false;
  requests: string[] = [];
  pdf!: Uint8Array;

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    this.requests.push(`${method} ${url.pathname}`);
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const authz = new Headers(init?.headers).get('authorization');
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      this.refreshes++;
      if (this.refreshFails) return json({ error: 'invalid_grant' }, 400);
      return json({
        access_token: `at_fresh_${this.refreshes}`,
        expires_in: 3600,
        scope: 'openid https://www.googleapis.com/auth/drive.file',
      });
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      this.revoked.push(String(new URLSearchParams(String(init?.body)).get('token')));
      return json({});
    }
    if (!authz?.startsWith('Bearer at_')) return json({ error: { message: 'unauth' } }, 401);
    if (url.host === 'openidconnect.googleapis.com')
      return json({ sub: 'g-123', email: 'drive.owner@example.test' });
    const m = url.pathname.match(/^\/(?:upload\/)?drive\/v3\/files(?:\/([^/]+))?(\/export)?$/);
    if (!m) return json({ error: { message: 'no route' } }, 404);
    const [, id, exp] = m;
    if (method === 'GET' && !id) {
      const q = url.searchParams.get('q') ?? '';
      const key = q.match(/key='(\w+)' and value='([^']+)'/);
      const parent = q.match(/^'([^']+)' in parents/);
      const files = [...this.files.values()].filter(
        (f) =>
          !f.trashed &&
          (!key || f.appProperties?.[key[1]!] === key[2]) &&
          (!parent || f.parents?.includes(parent[1]!)),
      );
      return json({ files: files.map(({ id, name, mimeType }) => ({ id, name, mimeType })) });
    }
    if (method === 'GET' && id) {
      const f = this.files.get(id);
      if (!f) return json({ error: { errors: [{ reason: 'notFound' }] } }, 404);
      if (exp) return new Response(Buffer.from(this.pdf), { status: 200 });
      if (url.searchParams.get('alt') === 'media')
        return new Response(Buffer.from(f.bytes ?? this.pdf), { status: 200 });
      return json({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: String((f.bytes ?? this.pdf).byteLength),
        trashed: f.trashed,
      });
    }
    if (method === 'POST' && url.pathname.startsWith('/upload/')) {
      if (this.uploadFailsOnce) {
        this.uploadFailsOnce = false;
        return json({ error: { message: 'backend' } }, 503);
      }
      const body = Buffer.from(init!.body as Uint8Array).toString('latin1');
      const meta = JSON.parse(body.slice(body.indexOf('{'), body.indexOf('}\r\n') + 1));
      const nid = `up_${this.files.size}_${Math.random().toString(36).slice(2, 10)}`;
      this.files.set(nid, { id: nid, ...meta });
      return json({ id: nid, name: meta.name });
    }
    if (method === 'POST') {
      const meta = JSON.parse(String(init!.body));
      const nid = `folder_${Math.random().toString(36).slice(2, 12)}`;
      this.files.set(nid, { id: nid, ...meta });
      return json({ id: nid, name: meta.name });
    }
    return json({ error: { message: 'unsupported' } }, 400);
  };
}

const google = new FakeGoogle();
const rt: IntegrationRuntime = {
  encKey,
  google: {
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'https://app.test/api/integrations/google_drive/callback',
  },
  fetch: google.fetch,
};
const tokens = (over = {}) => ({
  accessToken: 'at_initial',
  refreshToken: 'rt_initial',
  expiresAt: new Date(Date.now() + 3600_000),
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  ...over,
});

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function png() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(40, 0);
  ihdr.writeUInt32BE(16, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc((40 * 4 + 1) * 16))),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

beforeAll(async () => {
  owner = await makeUser('int_owner');
  viewer = await makeUser('int_viewer');
  outsider = await makeUser('int_outsider');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Drive Studio' })).id;
  otherWs = (await createWorkspace(db, { userId: outsider }, { name: 'Other Studio' })).id;
  await addMember(ws, viewer, 'viewer');
  google.pdf = await makePdf(2);
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('marketplace catalogue', () => {
  it('keeps availability separate from connection state', () => {
    const drive = INTEGRATIONS.find((i) => i.key === 'google_drive')!;
    const hubspot = INTEGRATIONS.find((i) => i.key === 'hubspot')!;
    expect(resolveAvailability(hubspot)).toBe('coming_soon');
    expect(canConnect(resolveAvailability(hubspot))).toBe(false);
    expect(resolveAvailability(drive, { configured: false, flagEnabled: true })).toBe(
      'unavailable',
    );
    expect(resolveAvailability(drive, { configured: true, flagEnabled: false })).toBe(
      'maintenance',
    );
    expect(resolveAvailability(drive, { configured: true, flagEnabled: true })).toBe('beta');
    expect(connectionState(null)).toBe('not_connected');
    expect(connectionState({ status: 'disabled' })).toBe('disconnected');
    expect(connectionState({ status: 'expired' })).toBe('expired');
    expect(
      connectionState({ status: 'active', lastErrorAt: new Date(2), lastSuccessAt: new Date(1) }),
    ).toBe('error');
    expect(connectionState({ status: 'active', lastErrorAt: null })).toBe('connected');
  });

  it('only marks connectors with real code as available, and lists the roadmap', () => {
    expect(
      INTEGRATIONS.filter((i) => i.available)
        .map((i) => i.key)
        .sort(),
    ).toEqual(['beam_artist', 'google_drive', 'jectstack', 'slack']);
    for (const k of ['zapier', 'hubspot', 'make', 'pipedrive', 'salesforce', 'zoho_crm'])
      expect(INTEGRATIONS.find((i) => i.key === k)?.available).toBe(false);
  });

  it('searches by name, category, description and capability', () => {
    expect(searchIntegrations(INTEGRATIONS, 'drive').map((i) => i.key)).toContain('google_drive');
    expect(
      searchIntegrations(INTEGRATIONS, '', 'CRM & Sales').every(
        (i) => i.category === 'CRM & Sales',
      ),
    ).toBe(true);
    expect(searchIntegrations(INTEGRATIONS, 'certificates').map((i) => i.key)).toContain(
      'google_drive',
    );
    expect(searchIntegrations(INTEGRATIONS, 'nothing-matches-this')).toEqual([]);
  });

  it('names Drive files safely', () => {
    expect(driveFileName('Lease: Unit 4/B', 'signed', {})).toBe('Lease Unit 4 B - Signed.pdf');
    expect(
      driveFileName('Lease', 'certificate', {
        naming: 'title_date',
        completedAt: new Date('2026-11-13T10:00:00Z'),
        certificateNumber: 'CERT-2026-000001',
      }),
    ).toBe('Lease 2026-11-13 - Certificate of Completion CERT-2026-000001.pdf');
  });
});

describe('OAuth state', () => {
  const start = () =>
    beginOAuth(
      {
        provider: 'google_drive',
        userId: 'u1',
        workspaceId: crypto.randomUUID(),
        returnTo: '/app/integrations/google_drive',
      },
      encKey,
      1_000_000,
    );

  it('accepts the matching state from the same member', () => {
    const s = start();
    const r = completeOAuth(
      s.cookie,
      { state: s.state, provider: 'google_drive', userId: 'u1' },
      encKey,
      1_000_000 + 1000,
    );
    expect(r.ok).toBe(true);
    expect(s.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects a wrong state, a tampered or missing cookie, another member and a stale flow', () => {
    const s = start();
    const check = (
      over: Partial<{ state: string | null; userId: string; provider: string }>,
      now = 1_000_000,
      cookie: string | undefined = s.cookie,
    ) =>
      completeOAuth(
        cookie,
        { state: s.state, provider: 'google_drive', userId: 'u1', ...over },
        encKey,
        now,
      );
    expect(check({ state: 'x'.repeat(43) })).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(check({ state: null })).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(check({ provider: 'hubspot' })).toEqual({ ok: false, reason: 'state_mismatch' });
    expect(check({ userId: 'u2' })).toEqual({ ok: false, reason: 'wrong_user' });
    expect(check({}, 1_000_000 + 11 * 60_000)).toEqual({ ok: false, reason: 'expired' });
    expect(
      completeOAuth(
        undefined,
        { state: s.state, provider: 'google_drive', userId: 'u1' },
        encKey,
        1_000_000,
      ),
    ).toEqual({ ok: false, reason: 'missing' });
    expect(check({}, 1_000_000, s.cookie.slice(0, -4) + 'AAAA')).toEqual({
      ok: false,
      reason: 'tampered',
    });
  });

  it('never redirects off-site after connecting', () => {
    const s = beginOAuth(
      {
        provider: 'google_drive',
        userId: 'u1',
        workspaceId: crypto.randomUUID(),
        returnTo: '//evil.example',
      },
      encKey,
    );
    const r = completeOAuth(
      s.cookie,
      { state: s.state, provider: 'google_drive', userId: 'u1' },
      encKey,
    );
    expect(r.ok && r.pending.returnTo).toBe('/app/integrations');
  });
});

describe('Google Drive connection', () => {
  it('is refused for members who cannot manage integrations', async () => {
    await expect(
      saveOAuthConnection(db, { userId: viewer }, ws, 'google_drive', tokens(), rt),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      saveOAuthConnection(db, { userId: owner }, ws, 'hubspot', tokens(), rt),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      connectIntegration(db, { userId: owner }, ws, { provider: 'google_drive' }, { encKey }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('connects, stores tokens sealed and shows the account', async () => {
    await saveOAuthConnection(db, { userId: owner }, ws, 'google_drive', tokens(), rt);
    const c = await getConnection(db, { userId: viewer }, ws, 'google_drive');
    expect(c).toMatchObject({ status: 'active', externalAccountLabel: 'drive.owner@example.test' });
    const [cred] = await owner_.db
      .select()
      .from(schema.integrationCredentials)
      .where(sql`${schema.integrationCredentials.connectionId} = ${c!.id}`);
    expect(cred!.secretEncrypted).toMatch(/^v1\./);
    expect(cred!.secretEncrypted).not.toContain('rt_initial');
    const list = await listConnections(db, { userId: owner }, ws);
    expect(JSON.stringify(list)).not.toContain('v1.');
    // Another workspace sees nothing.
    expect(await getConnection(db, { userId: outsider }, ws, 'google_drive')).toBeNull();
    await expect(
      getAccessToken(db, { userId: outsider }, otherWs, 'google_drive', rt),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refreshes an expired access token and stores the new one', async () => {
    const c = await getConnection(db, { userId: owner }, ws, 'google_drive');
    await owner_.db
      .update(schema.integrationCredentials)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(sql`${schema.integrationCredentials.connectionId} = ${c!.id}`);
    const before = google.refreshes;
    const t = await getAccessToken(db, { userId: viewer }, ws, 'google_drive', rt);
    expect(t.accessToken).toMatch(/^at_fresh_/);
    expect(google.refreshes).toBe(before + 1);
    const again = await getAccessToken(db, { userId: viewer }, ws, 'google_drive', rt);
    expect(again.accessToken).toBe(t.accessToken);
    expect(google.refreshes).toBe(before + 1);
  });

  it('imports a picked PDF or Google Doc into a draft, linked to the Drive file', async () => {
    google.files.set('pdfFile00001', {
      id: 'pdfFile00001',
      name: 'Vendor Agreement.pdf',
      mimeType: 'application/pdf',
    });
    google.files.set('docFile00001', {
      id: 'docFile00001',
      name: 'Wholesale Terms',
      mimeType: 'application/vnd.google-apps.document',
    });
    const a = await importFromGoogleDrive(
      db,
      storage,
      { userId: owner },
      ws,
      'pdfFile00001',
      rt,
      LIMITS,
    );
    const b = await importFromGoogleDrive(
      db,
      storage,
      { userId: owner },
      ws,
      'docFile00001',
      rt,
      LIMITS,
    );
    const da = await getDocument(db, { userId: owner }, a.documentId);
    const db_ = await getDocument(db, { userId: owner }, b.documentId);
    expect(da.document).toMatchObject({
      title: 'Vendor Agreement',
      externalSource: 'google_drive',
      externalId: 'pdfFile00001',
    });
    expect(db_.document.title).toBe('Wholesale Terms');
    expect(google.requests).toContain('GET /drive/v3/files/docFile00001/export');
    const maps = await owner_.db
      .select()
      .from(schema.integrationMappings)
      .where(sql`${schema.integrationMappings.workspaceId} = ${ws}`);
    expect(maps.map((m) => m.externalObjectId).sort()).toEqual(['docFile00001', 'pdfFile00001']);
  });

  it('refuses unsupported files and files it cannot see, and logs the failure', async () => {
    google.files.set('wordFile0001', {
      id: 'wordFile0001',
      name: 'Contract.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await expect(
      importFromGoogleDrive(db, storage, { userId: owner }, ws, 'wordFile0001', rt, LIMITS),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      importFromGoogleDrive(db, storage, { userId: owner }, ws, 'notPicked001', rt, LIMITS),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      importFromGoogleDrive(db, storage, { userId: owner }, ws, '../../etc', rt, LIMITS),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Viewers cannot create documents.
    google.files.set('pdfFile00002', {
      id: 'pdfFile00002',
      name: 'X.pdf',
      mimeType: 'application/pdf',
    });
    await expect(
      importFromGoogleDrive(db, storage, { userId: viewer }, ws, 'pdfFile00002', rt, LIMITS),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const log = await listIntegrationActivity(db, { userId: owner }, ws, {
      provider: 'google_drive',
    });
    expect(log.filter((l) => l.status === 'failed').map((l) => l.errorCode)).toEqual(
      expect.arrayContaining(['unsupported_file', 'not_found']),
    );
    expect(JSON.stringify(log)).not.toMatch(/at_|rt_initial/);
    // The log is not visible to viewers (no integrations.manage or audit.view).
    expect(await listIntegrationActivity(db, { userId: viewer }, ws)).toEqual([]);
  });
});

describe('saving finished documents to Drive', () => {
  async function completedRequest(title: string) {
    const actor = { userId: owner };
    const { id } = await createDocumentFromUpload(
      db,
      storage,
      actor,
      {
        workspaceId: ws,
        title,
        documentType: 'agreement',
        filename: `${title}.pdf`,
        bytes: await makePdf(1),
      },
      LIMITS,
    );
    await saveRecipients(
      db,
      actor,
      id,
      {
        signingOrderEnabled: false,
        recipients: [
          {
            name: 'Sam Signer',
            email: `sam-${crypto.randomUUID()}@example.test`,
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
    const sent = await sendForSignature(db, storage, actor, id, {
      mode: 'test',
      testSigningEnabled: true,
    });
    const token = sent.invitations[0]!.token;
    const { session } = (await startSigning(db, token)) as { session: string };
    const v = await getSignerView(db, token, session);
    await giveConsent(db, token, session, { disclosureVersion: v.disclosure.version, agree: true });
    const wsp = await getSigningWorkspace(db, token, session);
    const sig = await adoptSignature(db, token, session, {
      kind: 'signature',
      method: 'drawn',
      pngBase64: png(),
    });
    await completeSigning(db, storage, token, session, {
      intent: true,
      values: [
        { fieldId: wsp.fields.find((f) => f.type === 'signature')!.id, signatureId: sig.id },
      ],
    });
    await finalizeRequest(db, storage, { token }, sent.requestId);
    return sent.requestId;
  }

  it('does nothing while auto-save is off', async () => {
    await completedRequest('Off Agreement');
    const r = await runIntegrationJobs(db, storage, rt);
    expect(r.attempted).toBe(0);
  });

  it('saves the signed copy and certificate once, retrying a failed upload without duplicates', async () => {
    await updateIntegrationSettings(db, { userId: owner }, ws, 'google_drive', {
      autoSave: true,
      saveCertificate: true,
      naming: 'title',
    });
    await expect(
      updateIntegrationSettings(db, { userId: viewer }, ws, 'google_drive', { autoSave: false }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const requestId = await completedRequest('Supplier Agreement');
    google.uploadFailsOnce = true;
    const first = await runIntegrationJobs(db, storage, rt);
    expect(first).toMatchObject({ attempted: 1, failed: 1 });
    let [job] = await owner_.db
      .select()
      .from(schema.integrationJobs)
      .where(sql`${schema.integrationJobs.requestId} = ${requestId}::uuid`);
    expect(job).toMatchObject({ status: 'retrying', errorCode: 'provider_unavailable' });
    // Running again before the backoff does not pick it up.
    expect((await runIntegrationJobs(db, storage, rt)).attempted).toBe(0);
    await owner_.db
      .update(schema.integrationJobs)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(sql`${schema.integrationJobs.id} = ${job!.id}`);
    const second = await runIntegrationJobs(db, storage, rt);
    expect(second).toMatchObject({ attempted: 1, succeeded: 1 });
    [job] = await owner_.db
      .select()
      .from(schema.integrationJobs)
      .where(sql`${schema.integrationJobs.id} = ${job!.id}`);
    expect(job).toMatchObject({ status: 'succeeded', errorCode: null });
    const saved = [...google.files.values()].filter(
      (f) => f.mimeType === 'application/pdf' && f.appProperties?.stKey?.startsWith(job!.id),
    );
    expect(saved.map((f) => f.name).sort()).toEqual([
      expect.stringMatching(/^Supplier Agreement - Certificate of Completion/),
      'Supplier Agreement - Signed.pdf',
    ]);
    expect(saved.every((f) => f.parents?.length === 1)).toBe(true);
    // The event is never queued twice.
    expect((await runIntegrationJobs(db, storage, rt)).queued).toBe(0);
    const c = await getConnection(db, { userId: owner }, ws, 'google_drive');
    expect(c!.lastSuccessAt).not.toBeNull();
  });

  it('marks the connection expired when Google access is withdrawn, and lets a manager retry', async () => {
    const requestId = await completedRequest('Revoked Agreement');
    const c = await getConnection(db, { userId: owner }, ws, 'google_drive');
    await owner_.db
      .update(schema.integrationCredentials)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(sql`${schema.integrationCredentials.connectionId} = ${c!.id}`);
    google.refreshFails = true;
    const r = await runIntegrationJobs(db, storage, rt);
    expect(r.failed).toBe(1);
    const [job] = await owner_.db
      .select()
      .from(schema.integrationJobs)
      .where(sql`${schema.integrationJobs.requestId} = ${requestId}::uuid`);
    expect(job).toMatchObject({ status: 'failed', errorCode: 'auth_revoked' });
    expect((await getConnection(db, { userId: owner }, ws, 'google_drive'))!.status).toBe(
      'expired',
    );
    await expect(retryIntegrationJob(db, { userId: viewer }, job!.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await retryIntegrationJob(db, { userId: owner }, job!.id);
    google.refreshFails = false;
  });

  it('disconnects: revokes at Google, deletes tokens and cancels queued work', async () => {
    await disconnectOAuthIntegration(db, { userId: owner }, ws, 'google_drive', rt);
    expect(google.revoked.length).toBeGreaterThan(0);
    const c = await getConnection(db, { userId: owner }, ws, 'google_drive');
    expect(c!.status).toBe('disabled');
    const creds = await owner_.db
      .select()
      .from(schema.integrationCredentials)
      .where(sql`${schema.integrationCredentials.connectionId} = ${c!.id}`);
    expect(creds).toHaveLength(0);
    const open = await owner_.db
      .select()
      .from(schema.integrationJobs)
      .where(
        sql`${schema.integrationJobs.connectionId} = ${c!.id} and ${schema.integrationJobs.status} in ('pending','retrying')`,
      );
    expect(open).toHaveLength(0);
    await expect(
      importFromGoogleDrive(db, storage, { userId: owner }, ws, 'pdfFile00001', rt, LIMITS),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
