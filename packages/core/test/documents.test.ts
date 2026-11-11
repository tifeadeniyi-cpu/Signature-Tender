import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, withActor, schema } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  getDocument,
  listDocuments,
  saveRecipients,
  saveFields,
  saveSettings,
  markReadyToSend,
  deleteDraft,
  readDocumentFile,
  checkReadiness,
  canTransition,
  inspectPdf,
  documentSettingsSchema,
  MemoryStorage,
  AppError,
} from '../src';
import { APP_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const storage = new MemoryStorage();
const limits = { maxBytes: 5 * 1024 * 1024, maxPages: 100 };
let owner: string, editor: string, outsider: string, viewer: string, ws: string, docId: string;

beforeAll(async () => {
  owner = await makeUser('owner');
  editor = await makeUser('editor');
  outsider = await makeUser('outsider');
  viewer = await makeUser('viewer');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Docs WS' })).id;
  await addMember(ws, editor, 'editor');
  await addMember(ws, viewer, 'viewer');
  docId = (
    await createDocumentFromUpload(
      db,
      storage,
      { userId: owner },
      {
        workspaceId: ws,
        title: 'Artist Agreement',
        documentType: 'agreement',
        filename: 'a.pdf',
        bytes: await makePdf(3),
      },
      limits,
    )
  ).id;
});
afterAll(() => close());

describe('upload validation', () => {
  it('rejects non-PDF bytes', async () => {
    await expect(inspectPdf(new TextEncoder().encode('hello world'), limits)).rejects.toMatchObject(
      { code: 'invalid' },
    );
  });
  it('rejects damaged PDFs', async () => {
    await expect(
      inspectPdf(new TextEncoder().encode('%PDF-1.7 garbage'), limits),
    ).rejects.toMatchObject({ message: expect.stringContaining('could not be read') });
  });
  it('rejects oversized and too-long files', async () => {
    const pdf = await makePdf(3);
    await expect(inspectPdf(pdf, { maxBytes: 10, maxPages: 100 })).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(inspectPdf(pdf, { maxBytes: limits.maxBytes, maxPages: 2 })).rejects.toMatchObject(
      { message: expect.stringContaining('more than 2 pages') },
    );
  });
  it('stores the file privately with its hash and page count', async () => {
    const d = await getDocument(db, { userId: owner }, docId);
    expect(d.document.status).toBe('ready_for_preparation');
    expect(d.file?.pageCount).toBe(3);
    expect(d.file?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.file?.storageKey.startsWith(`ws/${ws}/doc/${docId}/`)).toBe(true);
    expect(storage.objects.has(d.file!.storageKey)).toBe(true);
  });
  it('viewers cannot upload', async () => {
    await expect(
      createDocumentFromUpload(
        db,
        storage,
        { userId: viewer },
        {
          workspaceId: ws,
          title: 'X',
          documentType: 'agreement',
          filename: 'x.pdf',
          bytes: await makePdf(1),
        },
        limits,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('access control', () => {
  it('outsiders cannot read the document, its file or its rows', async () => {
    await expect(getDocument(db, { userId: outsider }, docId)).rejects.toBeInstanceOf(AppError);
    await expect(readDocumentFile(db, storage, { userId: outsider }, docId)).rejects.toBeInstanceOf(
      AppError,
    );
    const files = await withActor(db, { userId: outsider }, (tx) =>
      tx.select().from(schema.documentFiles),
    );
    expect(files.find((f) => f.documentId === docId)).toBeUndefined();
  });
  it('editors only see their own documents', async () => {
    expect(
      (await listDocuments(db, { userId: editor }, ws)).find((d) => d.id === docId),
    ).toBeUndefined();
    await expect(getDocument(db, { userId: editor }, docId)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('viewers can read but not edit', async () => {
    const d = await getDocument(db, { userId: viewer }, docId);
    expect(d.canEdit).toBe(false);
    await expect(
      saveSettings(db, { userId: viewer }, docId, { settings: {} }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('preparation', () => {
  it('validates recipients: at least one signer, no duplicates, signer limit', async () => {
    const a = { name: 'A', email: 'a@x.test', role: 'cc' as const, signingOrder: 1 };
    await expect(
      saveRecipients(
        db,
        { userId: owner },
        docId,
        { signingOrderEnabled: false, recipients: [a] },
        { maxSigners: 5 },
      ),
    ).rejects.toMatchObject({ message: 'Add at least one signer.' });
    const s = { name: 'S', email: 'S@X.test', role: 'signer' as const, signingOrder: 1 };
    await expect(
      saveRecipients(
        db,
        { userId: owner },
        docId,
        { signingOrderEnabled: false, recipients: [s, { ...s, email: 's@x.test', role: 'cc' }] },
        { maxSigners: 5 },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('more than once') });
    const six = Array.from({ length: 6 }, (_, i) => ({ ...s, email: `s${i}@x.test` }));
    await expect(
      saveRecipients(
        db,
        { userId: owner },
        docId,
        { signingOrderEnabled: false, recipients: six },
        { maxSigners: 5 },
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('saves recipients, fields and settings, then reports readiness', async () => {
    await saveRecipients(
      db,
      { userId: owner },
      docId,
      {
        signingOrderEnabled: true,
        recipients: [
          { name: 'Aremmic Aje', email: 'aremmic@x.test', role: 'signer', signingOrder: 1 },
          { name: 'Tope Okafor', email: 'tope@x.test', role: 'signer', signingOrder: 2 },
          { name: 'David Ajayi', email: 'david@x.test', role: 'cc', signingOrder: 3 },
        ],
      },
      { maxSigners: 5 },
    );
    let d = await getDocument(db, { userId: owner }, docId);
    expect(d.document.status).toBe('preparing');
    const [aremmic, tope, david] = d.recipients;
    expect(tope!.signingOrder).toBe(2);

    await expect(
      saveFields(db, { userId: owner }, docId, [
        {
          recipientId: david!.id,
          type: 'signature',
          page: 1,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.05,
        },
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining('receive a copy') });
    await expect(
      saveFields(db, { userId: owner }, docId, [
        {
          recipientId: aremmic!.id,
          type: 'signature',
          page: 9,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.05,
        },
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining('does not exist') });
    await expect(
      saveFields(db, { userId: owner }, docId, [
        {
          recipientId: aremmic!.id,
          type: 'signature',
          page: 1,
          x: 0.9,
          y: 0.1,
          width: 0.2,
          height: 0.05,
        },
      ]),
    ).rejects.toThrow();

    await saveFields(db, { userId: owner }, docId, [
      {
        recipientId: aremmic!.id,
        type: 'signature',
        page: 3,
        x: 0.1,
        y: 0.8,
        width: 0.25,
        height: 0.06,
      },
    ]);
    expect(await markReadyToSend(db, { userId: owner }, docId)).toEqual([
      { step: 'fields', message: 'Place at least one signature field for Tope Okafor.' },
    ]);

    await saveFields(db, { userId: owner }, docId, [
      {
        recipientId: aremmic!.id,
        type: 'signature',
        page: 3,
        x: 0.1,
        y: 0.8,
        width: 0.25,
        height: 0.06,
      },
      {
        recipientId: tope!.id,
        type: 'signature',
        page: 3,
        x: 0.6,
        y: 0.8,
        width: 0.25,
        height: 0.06,
      },
      {
        recipientId: tope!.id,
        type: 'date_signed',
        page: 3,
        x: 0.6,
        y: 0.88,
        width: 0.2,
        height: 0.04,
        required: true,
      },
    ]);
    await expect(
      saveSettings(db, { userId: owner }, docId, { settings: { expiresAt: '2001-01-01' } }),
    ).rejects.toMatchObject({ code: 'invalid' });
    await saveSettings(db, { userId: owner }, docId, {
      settings: { reminderEveryDays: 5, allowPrint: false },
      emailMessage: 'Please sign',
    });

    expect(await markReadyToSend(db, { userId: owner }, docId)).toEqual([]);
    d = await getDocument(db, { userId: owner }, docId);
    expect(d.document.status).toBe('ready_to_send');
    expect(d.document.settings.reminderEveryDays).toBe(5);
    expect(d.fields).toHaveLength(3);
  });

  it('removing a recipient removes their fields', async () => {
    const d = await getDocument(db, { userId: owner }, docId);
    const keep = d.recipients
      .filter((r) => r.email !== 'tope@x.test')
      .map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        signingOrder: r.signingOrder,
      }));
    await saveRecipients(
      db,
      { userId: owner },
      docId,
      { signingOrderEnabled: true, recipients: keep },
      { maxSigners: 5 },
    );
    const after = await getDocument(db, { userId: owner }, docId);
    expect(after.fields).toHaveLength(1);
    expect(after.document.status).toBe('preparing');
  });

  it('serves the file with an integrity check and logs access', async () => {
    const { bytes } = await readDocumentFile(db, storage, { userId: owner }, docId);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    const d = await getDocument(db, { userId: owner }, docId);
    const obj = storage.objects.get(d.file!.storageKey)!;
    const tampered = new Uint8Array(obj.body);
    tampered[tampered.length - 10] = (tampered[tampered.length - 10] ?? 0) ^ 0xff;
    storage.objects.set(d.file!.storageKey, { ...obj, body: tampered });
    await expect(readDocumentFile(db, storage, { userId: owner }, docId)).rejects.toThrow(
      /Integrity/,
    );
    storage.objects.set(d.file!.storageKey, obj);
  });

  it('soft-deletes drafts so they disappear for everyone', async () => {
    const id = (
      await createDocumentFromUpload(
        db,
        storage,
        { userId: owner },
        {
          workspaceId: ws,
          title: 'Temp',
          documentType: 'other',
          filename: 't.pdf',
          bytes: await makePdf(1),
        },
        limits,
      )
    ).id;
    await deleteDraft(db, { userId: owner }, id);
    await expect(getDocument(db, { userId: owner }, id)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('pure rules', () => {
  it('allows only defined state transitions', () => {
    expect(canTransition('preparing', 'ready_to_send')).toBe(true);
    expect(canTransition('draft', 'ready_to_send')).toBe(false);
    expect(canTransition('ready_to_send', 'preparing')).toBe(true);
  });
  it('requires initials when the signing method is initials only', () => {
    const settings = documentSettingsSchema.parse({ signingMethod: 'initials_only' });
    const issues = checkReadiness({
      file: { pageCount: 1 },
      recipients: [{ id: 'r1', name: 'A', role: 'signer' }],
      fields: [{ recipientId: 'r1', type: 'signature', page: 1 }],
      settings,
    });
    expect(issues[0]?.message).toContain('initials');
  });
});
