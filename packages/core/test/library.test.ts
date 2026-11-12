import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { createDb, withRetrieval, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  deleteDraft,
  sendForSignature,
  startSigning,
  getSignerView,
  giveConsent,
  getSigningWorkspace,
  adoptSignature,
  completeSigning,
  finalizeRequest,
  cancelRequest,
  searchLibrary,
  setArchived,
  listDeletedDrafts,
  restoreDeletedDraft,
  getDocumentRecord,
  readDocumentVersion,
  setRetentionPolicy,
  getRetentionPolicies,
  setLegalHold,
  purgeExpiredRecord,
  startRetrieval,
  verifyRetrieval,
  listRetrievable,
  readRetrievedFile,
  reissueSigningLink,
  hashSecret,
  MemoryStorage,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const TEST = { mode: 'test' as const, testSigningEnabled: true };
const RUN = Date.now().toString(36);
let owner: string, viewer: string, editor: string, ws: string;

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

async function readyDoc(
  title: string,
  signerEmail: string,
  opts: { allowDownload?: boolean; type?: string } = {},
) {
  const actor = { userId: owner };
  const { id } = await createDocumentFromUpload(
    db,
    storage,
    actor,
    {
      workspaceId: ws,
      title,
      documentType: opts.type ?? 'agreement',
      filename: `${title}.pdf`,
      bytes: await makePdf(1),
    },
    { maxBytes: 5 * 1024 * 1024, maxPages: 10 },
  );
  await saveRecipients(
    db,
    actor,
    id,
    {
      signingOrderEnabled: false,
      recipients: [
        {
          name: 'Signer',
          email: signerEmail,
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
  if (opts.allowDownload === false) {
    await owner_.db
      .update(schema.documents)
      .set({ settings: { ...d.document.settings, allowDownload: false } })
      .where(sql`${schema.documents.id} = ${id}`);
  }
  expect(await markReadyToSend(db, actor, id)).toEqual([]);
  return id;
}

async function sendAndComplete(docId: string) {
  const sent = await sendForSignature(db, storage, { userId: owner }, docId, TEST);
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
    values: [{ fieldId: wsp.fields[0]!.id, signatureId: sig.id }],
  });
  await finalizeRequest(db, storage, { token }, sent.requestId);
  return sent.requestId;
}

/** Runs the verified-email flow and returns the session token. */
async function verifiedSession(email: string) {
  const start = await startRetrieval(db, email, {
    ipAddress: `10.0.0.${Math.floor(Math.random() * 250)}`,
  });
  expect(start.code).not.toBeNull();
  return verifyRetrieval(db, start.sessionId, email, start.code!);
}

let completedDoc: string, completedReq: string, openDoc: string, openReq: string;
const signerA = `a-${RUN}@example.test`;
const signerB = `b-${RUN}@example.test`;

beforeAll(async () => {
  owner = await makeUser('lib_owner');
  viewer = await makeUser('lib_viewer');
  editor = await makeUser('lib_editor');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Library WS' })).id;
  await addMember(ws, viewer, 'viewer');
  await addMember(ws, editor, 'editor');
  completedDoc = await readyDoc('Studio Lease', signerA, { type: 'contract' });
  completedReq = await sendAndComplete(completedDoc);
  openDoc = await readyDoc('Tour Booking', signerA);
  openReq = (await sendForSignature(db, storage, { userId: owner }, openDoc, TEST)).requestId;
  await readyDoc('Draft NDA', signerB);
}, 60_000);
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('library search', () => {
  it('puts each document in one tab and counts without double counting', async () => {
    const r = await searchLibrary(db, { userId: owner }, ws, {});
    expect(r.counts).toMatchObject({
      completed: 1,
      in_progress: 1,
      drafts: 1,
      all: 3,
      archived: 0,
    });
    expect(r.rows).toHaveLength(3);
    const done = await searchLibrary(db, { userId: owner }, ws, { tab: 'completed' });
    expect(done.rows.map((x) => x.title)).toEqual(['Studio Lease']);
    expect(done.rows[0]!.canDownload).toBe(true);
    expect(done.rows[0]!.completedAt).toBeInstanceOf(Date);
  });

  it('searches by name, signer email and document id, and filters by type', async () => {
    const byName = await searchLibrary(db, { userId: owner }, ws, { q: 'tour' });
    expect(byName.rows.map((x) => x.title)).toEqual(['Tour Booking']);
    const byEmail = await searchLibrary(db, { userId: owner }, ws, { q: signerB });
    expect(byEmail.rows.map((x) => x.title)).toEqual(['Draft NDA']);
    const byId = await searchLibrary(db, { userId: owner }, ws, { q: completedDoc });
    expect(byId.rows.map((x) => x.id)).toEqual([completedDoc]);
    const byType = await searchLibrary(db, { userId: owner }, ws, { type: 'contract' });
    expect(byType.rows.map((x) => x.title)).toEqual(['Studio Lease']);
    // LIKE wildcards in the query are treated literally.
    expect((await searchLibrary(db, { userId: owner }, ws, { q: '%' })).rows).toHaveLength(0);
    const sorted = await searchLibrary(db, { userId: owner }, ws, { sort: 'title', dir: 'asc' });
    expect(sorted.rows.map((x) => x.title)).toEqual(['Draft NDA', 'Studio Lease', 'Tour Booking']);
  });

  it('respects permissions: editors see only their own documents, outsiders nothing', async () => {
    expect((await searchLibrary(db, { userId: viewer }, ws, {})).rows).toHaveLength(3);
    expect((await searchLibrary(db, { userId: editor }, ws, {})).rows).toHaveLength(0);
    const outsider = await makeUser('lib_outsider');
    expect((await searchLibrary(db, { userId: outsider }, ws, {})).rows).toHaveLength(0);
  });
});

describe('archive and recovery', () => {
  it('archives closed documents only, and unarchives them', async () => {
    await expect(setArchived(db, { userId: owner }, openDoc, true)).rejects.toMatchObject({
      code: 'conflict',
    });
    await setArchived(db, { userId: owner }, completedDoc, true);
    let r = await searchLibrary(db, { userId: owner }, ws, {});
    expect(r.counts).toMatchObject({ archived: 1, completed: 0, all: 2 });
    r = await searchLibrary(db, { userId: owner }, ws, { tab: 'archived' });
    expect(r.rows.map((x) => x.id)).toEqual([completedDoc]);
    await expect(setArchived(db, { userId: viewer }, completedDoc, false)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await setArchived(db, { userId: owner }, completedDoc, false);
    expect((await searchLibrary(db, { userId: owner }, ws, {})).counts.completed).toBe(1);
  });

  it('restores a deleted draft within the recovery window', async () => {
    const id = await readyDoc('Mistake', signerB);
    await deleteDraft(db, { userId: owner }, id);
    const deleted = await listDeletedDrafts(db, { userId: owner }, ws);
    expect(deleted.map((d) => d.id)).toContain(id);
    await restoreDeletedDraft(db, { userId: owner }, id);
    expect((await getDocument(db, { userId: owner }, id)).document.title).toBe('Mistake');
    await owner_.db
      .update(schema.documents)
      .set({ deletedAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(sql`${schema.documents.id} = ${id}`);
    expect((await listDeletedDrafts(db, { userId: owner }, ws)).map((d) => d.id)).not.toContain(id);
    await expect(restoreDeletedDraft(db, { userId: owner }, id)).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

describe('document record', () => {
  it('lists versions and a merged activity timeline, and serves each version with an audit entry', async () => {
    const rec = await getDocumentRecord(db, { userId: owner }, completedDoc);
    expect(rec.files.map((f) => f.kind).sort()).toEqual(['certificate', 'original', 'signed']);
    expect(rec.requests).toHaveLength(1);
    const types = rec.activity.map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'document.uploaded',
        'request.sent',
        'recipient.signed',
        'request.completed',
      ]),
    );
    const signed = rec.files.find((f) => f.kind === 'signed')!;
    const got = await readDocumentVersion(db, storage, { userId: owner }, completedDoc, signed.id);
    expect(got.filename).toMatch(/-signed\.pdf$/);
    const after = await getDocumentRecord(db, { userId: owner }, completedDoc);
    expect(after.activity.map((a) => a.type)).toContain('document.file_downloaded');
    // A signed copy of a request that is not completed is never served.
    const other = await getDocumentRecord(db, { userId: owner }, openDoc);
    await expect(
      readDocumentVersion(db, storage, { userId: owner }, openDoc, signed.id),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(other.files.map((f) => f.kind)).toEqual(['original']);
  });
});

describe('retention and legal hold', () => {
  it('applies type, workspace and platform policies in that order', async () => {
    const rec = await getDocumentRecord(db, { userId: owner }, completedDoc);
    expect(rec.retention).toMatchObject({
      source: 'platform',
      days: 2555,
      eligibleForDeletion: false,
    });
    await expect(
      setRetentionPolicy(db, { userId: owner }, ws, { documentType: null, days: 10 }),
    ).rejects.toThrow(/at least 365/);
    await expect(
      setRetentionPolicy(db, { userId: viewer }, ws, { documentType: null, days: 400 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await setRetentionPolicy(db, { userId: owner }, ws, { documentType: null, days: 400 });
    await setRetentionPolicy(db, { userId: owner }, ws, { documentType: 'contract', days: 3650 });
    expect((await getDocumentRecord(db, { userId: owner }, completedDoc)).retention).toMatchObject({
      source: 'type',
      days: 3650,
    });
    await setRetentionPolicy(db, { userId: owner }, ws, { documentType: 'contract', days: null });
    const r = await getDocumentRecord(db, { userId: owner }, completedDoc);
    expect(r.retention).toMatchObject({ source: 'workspace', days: 400 });
    expect(r.retention.keepUntil!.getTime()).toBeGreaterThan(Date.now() + 399 * 86_400_000);
    expect((await getRetentionPolicies(db, { userId: viewer }, ws)).policies).toHaveLength(1);
  });

  it('deletes stored files only past retention, without legal hold, and only when switched on', async () => {
    const env = 'test' as const;
    await expect(
      purgeExpiredRecord(db, storage, { userId: owner }, completedDoc, env),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await owner_.db
      .update(schema.featureFlags)
      .set({ enabled: true })
      .where(sql`key = 'retention_deletion'`);
    try {
      await expect(
        purgeExpiredRecord(db, storage, { userId: owner }, completedDoc, env),
      ).rejects.toMatchObject({ code: 'conflict' });
      // Pretend the record closed long ago.
      await owner_.db
        .update(schema.signingRequests)
        .set({ completedAt: new Date(Date.now() - 500 * 86_400_000) })
        .where(sql`${schema.signingRequests.id} = ${completedReq}`);
      await setLegalHold(db, { userId: owner }, completedDoc, {
        hold: true,
        reason: 'Pending dispute',
      });
      await expect(
        purgeExpiredRecord(db, storage, { userId: owner }, completedDoc, env),
      ).rejects.toMatchObject({ code: 'conflict' });
      await expect(
        setLegalHold(db, { userId: viewer }, completedDoc, { hold: false }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await setLegalHold(db, { userId: owner }, completedDoc, { hold: false });
      const before = storage.objects.size;
      const out = await purgeExpiredRecord(db, storage, { userId: owner }, completedDoc, env);
      expect(out.deletedFiles).toBe(3);
      expect(storage.objects.size).toBe(before - 3);
      const rec = await getDocumentRecord(db, { userId: owner }, completedDoc);
      expect(rec.retention.purgedAt).toBeInstanceOf(Date);
      expect(rec.files).toHaveLength(3);
      expect(rec.activity.map((a) => a.type)).toContain('document.files_deleted');
      await expect(
        readDocumentVersion(db, storage, { userId: owner }, completedDoc, rec.files[0]!.id),
      ).rejects.toMatchObject({ message: expect.stringContaining('retention') });
    } finally {
      await owner_.db
        .update(schema.featureFlags)
        .set({ enabled: false })
        .where(sql`key = 'retention_deletion'`);
    }
  });
});

describe('verified-email retrieval', () => {
  let doc2: string, req2: string, noDl: string;
  beforeAll(async () => {
    doc2 = await readyDoc('Mix Agreement', signerB);
    req2 = await sendAndComplete(doc2);
    noDl = await sendAndComplete(await readyDoc('Private Deal', signerB, { allowDownload: false }));
  }, 60_000);

  it('never reveals whether an address has documents', async () => {
    const unknown = await startRetrieval(db, `nobody-${RUN}@example.test`);
    expect(unknown.code).toBeNull();
    expect(unknown.sessionId).toMatch(/[0-9a-f-]{36}/);
  });

  it('limits code attempts and rejects reuse', async () => {
    const s = await startRetrieval(db, signerB, { ipAddress: '10.9.9.9' });
    const wrong = s.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++)
      await expect(verifyRetrieval(db, s.sessionId, signerB, wrong)).rejects.toMatchObject({
        message: 'That code is not correct.',
      });
    await expect(verifyRetrieval(db, s.sessionId, signerB, wrong)).rejects.toThrow(/Too many/);
    await expect(verifyRetrieval(db, s.sessionId, signerB, s.code!)).rejects.toThrow(/Too many/);
    const ok = await startRetrieval(db, signerB, { ipAddress: '10.9.9.8' });
    await verifyRetrieval(db, ok.sessionId, signerB, ok.code!);
    await expect(verifyRetrieval(db, ok.sessionId, signerB, ok.code!)).rejects.toThrow(
      /already used/,
    );
    // A code for one address does not open another.
    const other = await startRetrieval(db, signerA, { ipAddress: '10.9.9.7' });
    await expect(verifyRetrieval(db, other.sessionId, signerB, other.code!)).rejects.toBeTruthy();
  });

  it('lists only that address’s requests and downloads allowed completed copies', async () => {
    const token = await verifiedSession(signerB);
    const list = await listRetrievable(db, token);
    expect(list.email).toBe(signerB);
    const ids = list.requests.map((r) => r.requestId);
    expect(ids).toEqual(expect.arrayContaining([req2, noDl]));
    expect(ids).not.toContain(completedReq);
    expect(ids).not.toContain(openReq);
    expect(list.requests.find((r) => r.requestId === noDl)!.canDownload).toBe(false);

    const file = await readRetrievedFile(db, storage, token, req2, 'signed');
    expect(Buffer.from(file.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    await readRetrievedFile(db, storage, token, req2, 'certificate');
    await expect(readRetrievedFile(db, storage, token, noDl, 'signed')).rejects.toMatchObject({
      code: 'not_found',
    });
    // Another recipient's request is invisible even with its id.
    await expect(
      readRetrievedFile(db, storage, token, completedReq, 'signed'),
    ).rejects.toMatchObject({ code: 'not_found' });
    const rec = await getDocumentRecord(db, { userId: owner }, doc2);
    expect(rec.activity.filter((a) => a.type === 'recipient.retrieved')).toHaveLength(2);

    // The session sees nothing of the workspace beyond its own requests.
    const seen = await withRetrieval(db, hashSecret(token), async (tx) => ({
      docs: (
        (await tx.execute(sql`select count(*)::int n from documents`)) as unknown as { n: number }[]
      )[0]!.n,
      ws: (
        (await tx.execute(sql`select count(*)::int n from workspaces`)) as unknown as {
          n: number;
        }[]
      )[0]!.n,
      others: (
        (await tx.execute(
          sql`select count(*)::int n from request_recipients where lower(email) <> ${signerB}`,
        )) as unknown as { n: number }[]
      )[0]!.n,
    }));
    expect(seen).toEqual({ docs: 0, ws: 0, others: 0 });
    await expect(listRetrievable(db, 'x'.repeat(43))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('reissues a lost signing link to the verified recipient and retires the old one', async () => {
    const token = await verifiedSession(signerA);
    const list = await listRetrievable(db, token);
    const open = list.requests.find((r) => r.requestId === openReq)!;
    expect(open.awaitingYou).toBe(true);
    expect(list.requests.find((r) => r.requestId === completedReq)!.awaitingYou).toBe(false);
    const [before] = await owner_.db
      .select({ h: schema.requestRecipients.tokenHash })
      .from(schema.requestRecipients)
      .where(sql`${schema.requestRecipients.requestId} = ${openReq}`);
    const out = await reissueSigningLink(db, token, openReq);
    expect(out.invitation.email).toBe(signerA);
    expect(hashSecret(out.invitation.token)).not.toBe(before!.h);
    expect((await getSignerView(db, out.invitation.token, undefined)).stage).toBe('start');
    await expect(reissueSigningLink(db, token, completedReq)).rejects.toMatchObject({
      code: 'conflict',
    });
    await cancelRequest(db, { userId: owner }, openReq, 'done');
    await expect(reissueSigningLink(db, token, openReq)).rejects.toBeTruthy();
  });

  it('rate limits code requests per address', async () => {
    const email = `limit-${RUN}@example.test`;
    for (let i = 0; i < 5; i++) await startRetrieval(db, email, { ipAddress: `10.1.1.${i}` });
    await expect(startRetrieval(db, email, { ipAddress: '10.1.1.9' })).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});
