import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { eq, sql } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
import {
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
  deriveIntegrationKeys,
  completeOAuthConnection,
  disconnectIntegrationConnection,
  runIntegrationJobs,
  listIntegrationActivity,
  listAutomations,
  listMappingsForDocument,
  updateConnectionSettings,
  importFromGoogleDrive,
  drivePickerToken,
  setDriveAutoSave,
  driveFileName,
  readDriveSettings,
  getConnector,
  resolveAvailability,
  type IntegrationContext,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { addMember, makePdf, makeUser } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const keys = deriveIntegrationKeys('google-drive-test-secret-0123456789abcdef');
const LIMITS = { maxBytes: 5 * 1024 * 1024, maxPages: 20 };

type FakeFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  bytes?: Uint8Array;
  trashed?: boolean;
};

/** In-memory stand-in for Google's token, userinfo and Drive endpoints. */
class FakeGoogle {
  files = new Map<string, FakeFile>();
  pdf!: Uint8Array;
  requests: string[] = [];
  uploadFailsOnce = false;
  revoked: string[] = [];
  seq = 0;

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${u.pathname}`);
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token')
      return Response.json({
        access_token: `ya29.fresh${++this.seq}`,
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid email https://www.googleapis.com/auth/drive.file',
      });
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') {
      this.revoked.push(new URLSearchParams(String(init.body)).get('token') ?? '');
      return new Response(null, { status: 200 });
    }
    const auth = new Headers(init.headers).get('authorization') ?? '';
    if (!auth.startsWith('Bearer ya29.')) return new Response(null, { status: 401 });
    if (u.host === 'openidconnect.googleapis.com')
      return Response.json({ sub: 'g-1', email: 'drive.owner@example.test' });
    if (u.pathname === '/drive/v3/about')
      return Response.json({ user: { emailAddress: 'drive.owner@example.test' } });
    const m = u.pathname.match(/^\/(?:upload\/)?drive\/v3\/files(?:\/([^/]+))?(\/export)?$/);
    if (!m) return Response.json({ error: { message: 'no route' } }, { status: 404 });
    const [, id, exp] = m;
    if (method === 'GET' && !id) {
      const q = u.searchParams.get('q') ?? '';
      const key = q.match(/key='(\w+)' and value='([^']+)'/);
      const parent = q.match(/^'([^']+)' in parents/);
      const files = [...this.files.values()].filter(
        (f) =>
          !f.trashed &&
          (!key || f.appProperties?.[key[1]!] === key[2]) &&
          (!parent || f.parents?.includes(parent[1]!)),
      );
      return Response.json({
        files: files.map(({ id, name, mimeType }) => ({ id, name, mimeType })),
      });
    }
    if (method === 'GET' && id) {
      const f = this.files.get(id);
      if (!f)
        return Response.json({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 });
      if (exp || u.searchParams.get('alt') === 'media')
        return new Response(Buffer.from(f.bytes ?? this.pdf));
      return Response.json({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: String((f.bytes ?? this.pdf).byteLength),
        trashed: f.trashed,
      });
    }
    if (method === 'POST' && u.pathname.startsWith('/upload/')) {
      if (this.uploadFailsOnce) {
        this.uploadFailsOnce = false;
        return new Response(null, { status: 503 });
      }
      const body = Buffer.from(init.body as Uint8Array).toString('latin1');
      const meta = JSON.parse(body.slice(body.indexOf('{'), body.indexOf('}\r\n') + 1)) as FakeFile;
      const nid = `upload_${++this.seq}_abcdefgh`;
      this.files.set(nid, { ...meta, id: nid });
      return Response.json({ id: nid, name: meta.name });
    }
    if (method === 'POST') {
      const meta = JSON.parse(String(init.body)) as FakeFile;
      const nid = `folder_${++this.seq}_abcdefgh`;
      this.files.set(nid, { ...meta, id: nid });
      return Response.json({ id: nid, name: meta.name });
    }
    return new Response(null, { status: 400 });
  };
}

const google = new FakeGoogle();
const ctx: IntegrationContext = {
  keys,
  oauthClient: (p) => (p === 'google_drive' ? { clientId: 'cid', clientSecret: 'secret' } : null),
  featureEnabled: true,
  fetch: google.fetch,
  storage,
};
let owner: string,
  editor: string,
  viewer: string,
  outsider: string,
  ws: string,
  otherWs: string,
  connId: string;

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
    values: [{ fieldId: wsp.fields.find((f) => f.type === 'signature')!.id, signatureId: sig.id }],
  });
  await finalizeRequest(db, storage, { token }, sent.requestId);
  return { requestId: sent.requestId, documentId: id };
}

const jobsFor = (requestId: string) =>
  owner_.db
    .select()
    .from(schema.integrationSyncJobs)
    .where(eq(schema.integrationSyncJobs.requestId, requestId));

beforeAll(async () => {
  owner = await makeUser('gd_owner');
  editor = await makeUser('gd_editor');
  viewer = await makeUser('gd_viewer');
  outsider = await makeUser('gd_outsider');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Drive Studio' })).id;
  otherWs = (await createWorkspace(db, { userId: outsider }, { name: 'Elsewhere' })).id;
  await addMember(ws, editor, 'editor');
  await addMember(ws, viewer, 'viewer');
  google.pdf = await makePdf(2);
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('Google Drive connector', () => {
  it('is built and connectable once its OAuth client is configured', () => {
    const def = getConnector('google_drive')!;
    expect(def.implemented).toBe(true);
    expect(def.auth.type === 'oauth2' && def.auth.scopes).toContain(
      'https://www.googleapis.com/auth/drive.file',
    );
    expect(resolveAvailability(def, {}, ctx)).toEqual({
      availability: 'beta',
      connectable: true,
      reason: null,
    });
    expect(resolveAvailability(def, {}, { ...ctx, oauthClient: () => null }).reason).toBe(
      'setup_required',
    );
  });

  it('connects a workspace account and labels it with the Google email', async () => {
    const r = await completeOAuthConnection(
      db,
      { userId: owner },
      {
        workspaceId: ws,
        provider: 'google_drive',
        visibility: 'workspace',
        tokens: {
          accessToken: 'ya29.initial',
          refreshToken: '1//refresh',
          tokenType: 'Bearer',
          expiresAt: new Date(Date.now() + 3600_000),
          scopes: [
            'openid',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/drive.file',
          ],
        },
      },
      ctx,
    );
    connId = r.connectionId;
    expect(r.account.label).toBe('drive.owner@example.test');
  });

  it('gives the Picker a short-lived token only to members who may use connections', async () => {
    const t = await drivePickerToken(db, { userId: editor }, ws, ctx);
    expect(t).toMatchObject({ connectionId: connId, token: expect.stringMatching(/^ya29\./) });
    await expect(drivePickerToken(db, { userId: viewer }, ws, ctx)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(drivePickerToken(db, { userId: outsider }, otherWs, ctx)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('imports a picked PDF or Google Doc into a draft linked to the Drive file', async () => {
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
      { userId: editor },
      ws,
      'pdfFile00001',
      ctx,
      LIMITS,
    );
    const b = await importFromGoogleDrive(
      db,
      storage,
      { userId: editor },
      ws,
      'docFile00001',
      ctx,
      LIMITS,
    );
    const da = await getDocument(db, { userId: editor }, a.documentId);
    expect(da.document).toMatchObject({
      title: 'Vendor Agreement',
      status: 'ready_for_preparation',
      externalSource: 'google_drive',
      externalId: 'pdfFile00001',
    });
    expect((await getDocument(db, { userId: editor }, b.documentId)).document.title).toBe(
      'Wholesale Terms',
    );
    expect(google.requests).toContain('GET /drive/v3/files/docFile00001/export');
    const links = await listMappingsForDocument(db, { userId: editor }, a.documentId);
    expect(links).toEqual([
      expect.objectContaining({
        provider: 'google_drive',
        externalObjectType: 'file',
        externalObjectId: 'pdfFile00001',
      }),
    ]);
  });

  it('refuses unsupported or unseen files and members who cannot create documents', async () => {
    google.files.set('wordFile0001', {
      id: 'wordFile0001',
      name: 'Contract.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await expect(
      importFromGoogleDrive(db, storage, { userId: editor }, ws, 'wordFile0001', ctx, LIMITS),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      importFromGoogleDrive(db, storage, { userId: editor }, ws, 'notPicked001', ctx, LIMITS),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      importFromGoogleDrive(db, storage, { userId: editor }, ws, '../../etc/x', ctx, LIMITS),
    ).rejects.toMatchObject({ code: 'invalid' });
    google.files.set('pdfFile00002', {
      id: 'pdfFile00002',
      name: 'X.pdf',
      mimeType: 'application/pdf',
    });
    await expect(
      importFromGoogleDrive(db, storage, { userId: viewer }, ws, 'pdfFile00002', ctx, LIMITS),
    ).rejects.toBeTruthy();
    const log = await listIntegrationActivity(db, { userId: owner }, ws, {
      provider: 'google_drive',
    });
    expect(
      log.filter((l) => l.action === 'drive.import' && l.status === 'failed').length,
    ).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(log)).not.toMatch(/ya29\.|1\/\/refresh/);
  });

  it('does not save finished documents while automatic saving is off', async () => {
    const { requestId } = await completedRequest('Off Agreement');
    expect(await jobsFor(requestId)).toHaveLength(0);
  });

  it('saves the signed copy and certificate once, retrying a failed upload without duplicates', async () => {
    await updateConnectionSettings(db, { userId: owner }, connId, {
      autoSave: true,
      saveCertificate: true,
      naming: 'title',
    });
    await setDriveAutoSave(db, { userId: owner }, ws, connId, true);
    await setDriveAutoSave(db, { userId: owner }, ws, connId, true);
    const autos = (await listAutomations(db, { userId: owner }, ws)).filter(
      (x) => x.action === 'drive.save_completed',
    );
    expect(autos).toHaveLength(1);
    expect(autos[0]).toMatchObject({ enabled: true, eventType: 'document.available' });

    const { requestId, documentId } = await completedRequest('Supplier Agreement');
    expect(await jobsFor(requestId)).toHaveLength(1);
    google.uploadFailsOnce = true;
    const first = await runIntegrationJobs(db, ctx);
    expect(first).toMatchObject({ claimed: 1, retrying: 1 });
    let [job] = await jobsFor(requestId);
    expect(job!.status).toBe('retrying');
    await owner_.db
      .update(schema.integrationSyncJobs)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(eq(schema.integrationSyncJobs.id, job!.id));
    const second = await runIntegrationJobs(db, ctx);
    expect(second).toMatchObject({ claimed: 1, succeeded: 1 });
    [job] = await jobsFor(requestId);
    expect(job!.status).toBe('succeeded');

    const saved = [...google.files.values()].filter((f) =>
      f.appProperties?.stKey?.startsWith(requestId),
    );
    expect(saved.map((f) => f.name).sort()).toEqual([
      expect.stringMatching(/^Supplier Agreement - Certificate of Completion/),
      'Supplier Agreement - Signed.pdf',
    ]);
    const folder = google.files.get(saved[0]!.parents![0]!)!;
    expect(folder).toMatchObject({
      name: 'Signature Tender',
      mimeType: 'application/vnd.google-apps.folder',
    });
    const links = await listMappingsForDocument(db, { userId: owner }, documentId);
    expect(links.map((l) => l.externalObjectType).sort()).toEqual([
      'certificate_file',
      'signed_file',
    ]);
    expect(links.every((l) => l.requestId === requestId)).toBe(true);
  });

  it('uses the chosen folder and can save one combined PDF', async () => {
    google.files.set('chosenFolder01', {
      id: 'chosenFolder01',
      name: 'Signed Agreements',
      mimeType: 'application/vnd.google-apps.folder',
    });
    await updateConnectionSettings(db, { userId: owner }, connId, {
      folderId: 'chosenFolder01',
      folderName: 'Signed Agreements',
      saveCombined: true,
      naming: 'title_date',
    });
    expect(readDriveSettings({ folderId: 'bad id!', folderName: 'x' })).toMatchObject({
      folderId: null,
      folderName: null,
    });
    const { requestId } = await completedRequest('Wholesale Contract');
    await runIntegrationJobs(db, ctx);
    const saved = [...google.files.values()].filter((f) =>
      f.appProperties?.stKey?.startsWith(requestId),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toMatch(
      /^Wholesale Contract \d{4}-\d{2}-\d{2} - Signed with Certificate\.pdf$/,
    );
    expect(saved[0]!.parents).toEqual(['chosenFolder01']);
  });

  it('names files safely', () => {
    expect(driveFileName('Lease: Unit 4/B', 'signed')).toBe('Lease Unit 4 B - Signed.pdf');
  });

  it('turns automatic saving off and disconnects cleanly', async () => {
    await setDriveAutoSave(db, { userId: owner }, ws, connId, false);
    const { requestId } = await completedRequest('After Off');
    expect(await jobsFor(requestId)).toHaveLength(0);
    await disconnectIntegrationConnection(db, { userId: owner }, connId, ctx);
    expect(google.revoked.length).toBeGreaterThan(0);
    await expect(
      importFromGoogleDrive(db, storage, { userId: editor }, ws, 'pdfFile00001', ctx, LIMITS),
    ).rejects.toMatchObject({ code: 'not_found' });
    const creds = await owner_.db
      .select()
      .from(schema.integrationCredentials)
      .where(sql`${schema.integrationCredentials.connectionId} = ${connId}`);
    expect(creds).toHaveLength(0);
  });
});
