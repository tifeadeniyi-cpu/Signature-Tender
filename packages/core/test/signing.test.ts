import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { sql } from 'drizzle-orm';
import { createDb, withSigner, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  sendForSignature,
  getSignerView,
  startSigning,
  verifySigningCode,
  giveConsent,
  getSigningWorkspace,
  adoptSignature,
  completeSigning,
  finalizeRequest,
  declineSigning,
  cancelRequest,
  getRequestsForDocument,
  verifyRequestIntegrity,
  readRequestFile,
  readSignerSignedFile,
  sanitizePng,
  hashSecret,
  verifyChain,
  MemoryStorage,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const limits = { maxBytes: 5 * 1024 * 1024, maxPages: 100 };
const TEST = { mode: 'test' as const, testSigningEnabled: true };
let owner: string, viewer: string, ws: string;

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
/** A small RGBA PNG with a text chunk that sanitizing must drop. */
function makePng(w = 40, h = 16) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw[y * (w * 4 + 1) + 1 + x * 4 + 3] = x === y ? 255 : 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Comment\0secret metadata')),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function preparedDoc(
  recipients: {
    name: string;
    email: string;
    role: 'signer' | 'cc' | 'approver' | 'reviewer';
    signingOrder: number;
    authMethod?: 'email_link' | 'email_code';
  }[],
  ordered = true,
) {
  const actor = { userId: owner };
  const { id } = await createDocumentFromUpload(
    db,
    storage,
    actor,
    {
      workspaceId: ws,
      title: 'Venue Booking',
      documentType: 'booking',
      filename: 'b.pdf',
      bytes: await makePdf(2),
    },
    limits,
  );
  await saveRecipients(
    db,
    actor,
    id,
    {
      signingOrderEnabled: ordered,
      recipients: recipients.map((r) => ({ authMethod: 'email_link', ...r })),
    },
    { maxSigners: 5 },
  );
  const d = await getDocument(db, actor, id);
  const fields = d.recipients
    .filter((r) => r.role === 'signer')
    .flatMap((r) => [
      {
        recipientId: r.id,
        type: 'signature' as const,
        page: 1,
        x: 0.1,
        y: 0.7,
        width: 0.3,
        height: 0.06,
      },
      {
        recipientId: r.id,
        type: 'date_signed' as const,
        page: 1,
        x: 0.5,
        y: 0.7,
        width: 0.2,
        height: 0.03,
      },
      {
        recipientId: r.id,
        type: 'text' as const,
        page: 2,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.03,
        label: 'Title',
        required: true,
      },
      {
        recipientId: r.id,
        type: 'checkbox' as const,
        page: 2,
        x: 0.1,
        y: 0.3,
        width: 0.03,
        height: 0.02,
        required: false,
      },
    ]);
  await saveFields(db, actor, id, fields);
  expect(await markReadyToSend(db, actor, id)).toEqual([]);
  return id;
}

beforeAll(async () => {
  owner = await makeUser('sender');
  viewer = await makeUser('viewer');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Signing WS' })).id;
  await addMember(ws, viewer, 'viewer');
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('signature image sanitizing', () => {
  it('keeps only drawing chunks and rejects non-PNG data', () => {
    const png = makePng();
    const clean = sanitizePng(png);
    expect(clean.includes(Buffer.from('secret metadata'))).toBe(false);
    expect(clean.length).toBeLessThan(png.length);
    expect(() =>
      sanitizePng(Buffer.from('GIF89a...........................................................')),
    ).toThrow();
    expect(() => sanitizePng(png.subarray(0, 50))).toThrow();
  });
});

describe('sending', () => {
  it('refuses live sending, disabled test signing, unprepared documents and viewers', async () => {
    const id = await preparedDoc([
      { name: 'Ann', email: 'ann@example.test', role: 'signer', signingOrder: 1 },
    ]);
    await expect(
      sendForSignature(db, storage, { userId: owner }, id, {
        mode: 'live',
        testSigningEnabled: true,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      sendForSignature(db, storage, { userId: owner }, id, {
        mode: 'test',
        testSigningEnabled: false,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(sendForSignature(db, storage, { userId: viewer }, id, TEST)).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    const { id: raw } = await createDocumentFromUpload(
      db,
      storage,
      { userId: owner },
      {
        workspaceId: ws,
        title: 'Raw',
        documentType: 'other',
        filename: 'r.pdf',
        bytes: await makePdf(1),
      },
      limits,
    );
    await expect(sendForSignature(db, storage, { userId: owner }, raw, TEST)).rejects.toMatchObject(
      { code: 'conflict' },
    );
  });
});

describe('sequential signing to completion', () => {
  let docId: string, requestId: string, annToken: string, benToken: string;
  let annSession: string, benSession: string;

  it('sends, notifies only the first signer, and freezes the draft', async () => {
    docId = await preparedDoc([
      {
        name: 'Ann Artist',
        email: 'ann@example.test',
        role: 'signer',
        signingOrder: 1,
        authMethod: 'email_code',
      },
      { name: 'Ben Venue', email: 'ben@example.test', role: 'signer', signingOrder: 2 },
      { name: 'Cara Copy', email: 'cara@example.test', role: 'cc', signingOrder: 3 },
    ]);
    const res = await sendForSignature(db, storage, { userId: owner }, docId, TEST);
    requestId = res.requestId;
    expect(res.invitations.map((i) => i.email)).toEqual(['ann@example.test']);
    annToken = res.invitations[0]!.token;
    await expect(saveFields(db, { userId: owner }, docId, [])).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      sendForSignature(db, storage, { userId: owner }, docId, TEST),
    ).rejects.toMatchObject({ code: 'conflict' });
    // Only the hash of the token is stored.
    const [row] = await owner_.db
      .select()
      .from(schema.requestRecipients)
      .where(sql`token_hash = ${hashSecret(annToken)}`);
    expect(row?.email).toBe('ann@example.test');
  });

  it('rejects unknown and malformed links', async () => {
    await expect(getSignerView(db, 'x'.repeat(43), undefined)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(getSignerView(db, 'not-a-token', undefined)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('requires a one-time email code with limited attempts', async () => {
    expect((await getSignerView(db, annToken, undefined)).stage).toBe('start');
    const first = await startSigning(db, annToken);
    expect('code' in first).toBe(true);
    // Resending immediately is rate limited.
    await expect(startSigning(db, annToken)).rejects.toMatchObject({ code: 'conflict' });
    expect((await getSignerView(db, annToken, undefined)).stage).toBe('verify');
    const code = (first as { code: string }).code;
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(verifySigningCode(db, annToken, wrong)).rejects.toMatchObject({
      message: expect.stringContaining('4 attempts left'),
    });
    annSession = (await verifySigningCode(db, annToken, code)).session;
    // Codes cannot be reused.
    await expect(verifySigningCode(db, annToken, code)).rejects.toMatchObject({ code: 'invalid' });
    expect((await getSignerView(db, annToken, annSession)).stage).toBe('consent');
    expect((await getSignerView(db, annToken, 'y'.repeat(43))).stage).toBe('start');
  });

  it('records consent, then shows only this signer’s fields', async () => {
    const view = await getSignerView(db, annToken, annSession);
    await expect(
      giveConsent(db, annToken, annSession, { disclosureVersion: 'old', agree: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(getSigningWorkspace(db, annToken, annSession)).rejects.toMatchObject({
      code: 'conflict',
    });
    await giveConsent(db, annToken, annSession, {
      disclosureVersion: view.disclosure.version,
      agree: true,
    });
    const wsp = await getSigningWorkspace(db, annToken, annSession);
    expect(wsp.fields).toHaveLength(4);
    expect(wsp.pageCount).toBe(2);
  });

  it('scopes a signer to their own request at the database level', async () => {
    const counts = await withSigner(db, hashSecret(annToken), async (tx) => {
      const docs = (await tx.execute(sql`select count(*)::int as n from documents`)) as unknown as {
        n: number;
      }[];
      const ws_ = (await tx.execute(sql`select count(*)::int as n from workspaces`)) as unknown as {
        n: number;
      }[];
      const reqs = (await tx.execute(
        sql`select count(*)::int as n from signing_requests`,
      )) as unknown as { n: number }[];
      const others = (await tx.execute(
        sql`update request_fields set value = 'x' where recipient_id <> st_current_signer() returning id`,
      )) as unknown as unknown[];
      return { docs: docs[0]!.n, ws: ws_[0]!.n, reqs: reqs[0]!.n, others: others.length };
    });
    expect(counts).toEqual({ docs: 1, ws: 0, reqs: 1, others: 0 });
  });

  it('validates required fields and completes atomically once', async () => {
    const wsp = await getSigningWorkspace(db, annToken, annSession);
    const sig = await adoptSignature(db, annToken, annSession, {
      kind: 'signature',
      method: 'typed',
      typedText: 'Ann Artist',
      font: 'Dancing Script',
      pngBase64: makePng().toString('base64'),
    });
    await expect(
      adoptSignature(db, annToken, annSession, {
        kind: 'signature',
        method: 'uploaded',
        pngBase64: Buffer.from('not an image at all, clearly').toString('base64'),
      }),
    ).rejects.toMatchObject({ code: 'invalid' });
    const byType = (t: string) => wsp.fields.find((f) => f.type === t)!.id;
    await expect(
      completeSigning(db, storage, annToken, annSession, {
        intent: true,
        values: [{ fieldId: byType('signature'), signatureId: sig.id }],
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Title') });
    const values = [
      { fieldId: byType('signature'), signatureId: sig.id },
      { fieldId: byType('text'), value: 'Headliner' },
      { fieldId: byType('checkbox'), value: 'true' },
    ];
    const res = await completeSigning(db, storage, annToken, annSession, { intent: true, values });
    expect(res.readyToFinalize).toBe(false);
    expect(res.invitations.map((i) => i.email)).toEqual(['ben@example.test']);
    benToken = res.invitations[0]!.token;
    await expect(
      completeSigning(db, storage, annToken, annSession, { intent: true, values }),
    ).rejects.toBeTruthy();
    expect((await getSignerView(db, annToken, undefined)).stage).toBe('signed_waiting');
  });

  it('finalizes after the last signer with a signed copy and certificate', async () => {
    const started = await startSigning(db, benToken);
    benSession = (started as { session: string }).session;
    const v = await getSignerView(db, benToken, benSession);
    await giveConsent(db, benToken, benSession, {
      disclosureVersion: v.disclosure.version,
      agree: true,
    });
    const wsp = await getSigningWorkspace(db, benToken, benSession);
    const sig = await adoptSignature(db, benToken, benSession, {
      kind: 'signature',
      method: 'drawn',
      pngBase64: makePng(60, 20).toString('base64'),
    });
    const res = await completeSigning(db, storage, benToken, benSession, {
      intent: true,
      values: [
        { fieldId: wsp.fields.find((f) => f.type === 'signature')!.id, signatureId: sig.id },
        { fieldId: wsp.fields.find((f) => f.type === 'text')!.id, value: 'Manager' },
      ],
    });
    expect(res.readyToFinalize).toBe(true);
    const fin = await finalizeRequest(db, storage, { token: benToken }, requestId);
    expect(fin.invitations.map((i) => i.email).sort()).toEqual([
      'ann@example.test',
      'ben@example.test',
      'cara@example.test',
    ]);
    expect(fin.invitations.find((i) => i.email === 'ben@example.test')!.token).toBe(benToken);

    const [req] = await getRequestsForDocument(db, { userId: owner }, docId);
    expect(req!.request.status).toBe('completed');
    expect(req!.events.map((e) => e.type)).toContain('request.completed');
    expect(req!.recipients.every((r) => !('tokenHash' in r))).toBe(true);

    const signed = await readRequestFile(db, storage, { userId: owner }, requestId, 'signed');
    const pdf = await PDFDocument.load(signed.bytes);
    expect(pdf.getPageCount()).toBe(2);
    const cert = await readRequestFile(db, storage, { userId: owner }, requestId, 'certificate');
    expect(Buffer.from(cert.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    // Recipients can download the completed copy with their completion link.
    const caraToken = fin.invitations.find((i) => i.email === 'cara@example.test')!.token;
    expect((await getSignerView(db, caraToken, undefined)).stage).toBe('completed');
    expect((await readSignerSignedFile(db, storage, caraToken)).bytes.byteLength).toBe(
      signed.bytes.byteLength,
    );
    // Finalizing again is a no-op.
    expect(
      (await finalizeRequest(db, storage, { actor: { userId: owner } }, requestId)).invitations,
    ).toEqual([]);
  });

  it('verifies file hashes and detects tampering with files or evidence', async () => {
    const ok = await verifyRequestIntegrity(db, storage, { userId: owner }, requestId);
    expect(ok).toMatchObject({
      original: { ok: true },
      signed: { ok: true },
      certificate: { ok: true },
      chain: { ok: true },
    });

    const events = await owner_.db
      .select()
      .from(schema.signingEvents)
      .where(sql`request_id = ${requestId}`)
      .orderBy(schema.signingEvents.seq);
    expect(verifyChain(events)).toBe(-1);
    const tampered = events.map((e, i) => (i === 2 ? { ...e, type: 'recipient.signed' } : e));
    expect(verifyChain(tampered)).toBe(2);

    // The app role cannot rewrite history.
    await expect(
      db.execute(sql`delete from signing_events where request_id = ${requestId}::uuid`),
    ).rejects.toThrow();

    const [req] = await getRequestsForDocument(db, { userId: owner }, docId);
    const [file] = await owner_.db
      .select()
      .from(schema.documentFiles)
      .where(sql`id = ${req!.request.signedFileId}`);
    await storage.delete(file!.storageKey);
    await storage.put(
      file!.storageKey,
      new TextEncoder().encode('%PDF-1.7 forged'),
      'application/pdf',
    );
    const bad = await verifyRequestIntegrity(db, storage, { userId: owner }, requestId);
    expect(bad.signed?.ok).toBe(false);
    await expect(
      readRequestFile(db, storage, { userId: owner }, requestId, 'signed'),
    ).rejects.toThrow(/Integrity/);
  });
});

describe('decline, cancel and expiry', () => {
  it('lets a signer decline with a reason, closing the request', async () => {
    const id = await preparedDoc([
      { name: 'Dee', email: 'dee@example.test', role: 'signer', signingOrder: 1 },
    ]);
    const { invitations } = await sendForSignature(db, storage, { userId: owner }, id, TEST);
    const t = invitations[0]!.token;
    const s = (await startSigning(db, t)) as { session: string };
    const res = await declineSigning(db, t, s.session, 'Wrong fee');
    expect(res.reason).toBe('Wrong fee');
    expect((await getSignerView(db, t, undefined)).stage).toBe('declined');
    // A declined request can be edited and sent again.
    await saveFields(
      db,
      { userId: owner },
      id,
      (await getDocument(db, { userId: owner }, id)).fields.map((f) => ({
        ...f,
        label: f.label,
        options: f.options as string[] | null,
      })),
    );
  });

  it('invalidates links when the sender cancels', async () => {
    const id = await preparedDoc([
      { name: 'Eve', email: 'eve@example.test', role: 'signer', signingOrder: 1 },
    ]);
    const { requestId, invitations } = await sendForSignature(
      db,
      storage,
      { userId: owner },
      id,
      TEST,
    );
    await expect(cancelRequest(db, { userId: viewer }, requestId, 'x')).rejects.toBeTruthy();
    await cancelRequest(db, { userId: owner }, requestId, 'Sent to the wrong person');
    await expect(getSignerView(db, invitations[0]!.token, undefined)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('expires requests past their expiration date', async () => {
    const id = await preparedDoc([
      { name: 'Fay', email: 'fay@example.test', role: 'signer', signingOrder: 1 },
    ]);
    const { requestId, invitations } = await sendForSignature(
      db,
      storage,
      { userId: owner },
      id,
      TEST,
    );
    await owner_.db.execute(
      sql`update signing_requests set expires_at = now() - interval '1 minute' where id = ${requestId}::uuid`,
    );
    expect((await getSignerView(db, invitations[0]!.token, undefined)).stage).toBe('expired');
    await expect(startSigning(db, invitations[0]!.token)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
