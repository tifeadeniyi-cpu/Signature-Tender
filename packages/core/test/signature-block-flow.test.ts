import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@st/db';
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
  giveConsent,
  getSigningWorkspace,
  adoptSignature,
  completeSigning,
  finalizeRequest,
  readRequestFile,
  getSignatureSeals,
  formatSigningTime,
  formatCertTime,
  MemoryStorage,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, makePdf } from './helpers';
import { pdfContent, pdfHex } from './pdf-text';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const TEST = { mode: 'test' as const, testSigningEnabled: true };
let owner: string, outsider: string, ws: string;

function png(w = 50, h = 18) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1) + 1 + y * 4 + 3] = 255;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

beforeAll(async () => {
  owner = await makeUser('blocksender');
  outsider = await makeUser('blockoutsider');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Block WS' })).id;
  await createWorkspace(db, { userId: outsider }, { name: 'Other WS' });
  await owner_.db
    .insert(schema.userProfiles)
    .values({ userId: owner, timezone: 'America/New_York' })
    .onConflictDoUpdate({
      target: schema.userProfiles.userId,
      set: { timezone: 'America/New_York' },
    });
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('signature blocks through a real signing', () => {
  let docId: string, requestId: string;
  const tokens: Record<string, string> = {};

  it('sends with option D by default and fixes the sender time zone on the request', async () => {
    const actor = { userId: owner };
    ({ id: docId } = await createDocumentFromUpload(
      db,
      storage,
      actor,
      {
        workspaceId: ws,
        title: 'Block test',
        documentType: 'agreement',
        filename: 'b.pdf',
        bytes: await makePdf(1),
      },
      { maxBytes: 5 * 1024 * 1024, maxPages: 10 },
    ));
    await saveRecipients(
      db,
      actor,
      docId,
      {
        signingOrderEnabled: false,
        recipients: [
          {
            name: 'Ann Artist',
            email: 'ann.block@example.test',
            role: 'signer',
            signingOrder: 1,
            authMethod: 'email_link',
          },
          {
            name: 'Ben Venue',
            email: 'ben.block@example.test',
            role: 'signer',
            signingOrder: 1,
            authMethod: 'email_link',
          },
        ],
      },
      { maxSigners: 5 },
    );
    const d = await getDocument(db, actor, docId);
    await saveFields(
      db,
      actor,
      docId,
      d.recipients.map((r, i) => ({
        recipientId: r.id,
        type: 'signature' as const,
        page: 1,
        x: 0.1,
        y: 0.5 + i * 0.15,
        width: 0.36,
        height: 0.1,
      })),
    );
    expect(await markReadyToSend(db, actor, docId)).toEqual([]);
    const res = await sendForSignature(db, storage, actor, docId, TEST);
    requestId = res.requestId;
    for (const inv of res.invitations) tokens[inv.email] = inv.token;
    const [req] = await owner_.db
      .select()
      .from(schema.signingRequests)
      .where(eq(schema.signingRequests.id, requestId));
    expect(req!.settings).toMatchObject({ signatureDisplay: 'full', timeZone: 'America/New_York' });
  });

  async function sign(
    email: string,
    extra: Record<string, unknown> = {},
    zone: { device?: string; ip?: string } = {},
  ) {
    const token = tokens[email]!;
    const { session } = (await startSigning(db, token)) as { session: string };
    const view = await getSignerView(db, token, session);
    await giveConsent(db, token, session, {
      disclosureVersion: view.disclosure.version,
      agree: true,
    });
    const wsp = await getSigningWorkspace(db, token, session);
    const sig = await adoptSignature(db, token, session, {
      kind: 'signature',
      method: 'typed',
      typedText: 'x',
      pngBase64: png(),
    });
    const before = Date.now();
    const res = await completeSigning(
      db,
      storage,
      token,
      session,
      {
        intent: true,
        timeZone: zone.device,
        // A forged time or name from the browser must be ignored.
        values: [{ fieldId: wsp.fields[0]!.id, signatureId: sig.id, ...extra }],
      } as never,
      { ipTimeZone: zone.ip ?? null },
    );
    return { res, before, token, session };
  }

  it('uses the server time for each signer and ignores client-sent metadata', async () => {
    // Ann's device reports her zone; Ben's browser sends nonsense, so his IP's zone is used.
    const a = await sign(
      'ann.block@example.test',
      { signedAt: '1999-01-01T00:00:00Z', name: 'Mallory' },
      { device: 'America/Los_Angeles', ip: 'Europe/London' },
    );
    expect(a.res.readyToFinalize).toBe(false);
    // A completed signer cannot add or change marks afterwards.
    await expect(
      adoptSignature(db, a.token, a.session, {
        kind: 'signature',
        method: 'typed',
        typedText: 'y',
        pngBase64: png(),
      }),
    ).rejects.toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100));
    const b = await sign('ben.block@example.test', {}, { device: 'Not/A_Zone', ip: 'Asia/Tokyo' });
    expect(b.res.readyToFinalize).toBe(true);
    await finalizeRequest(db, storage, { token: b.token }, requestId);

    const recips = await owner_.db
      .select()
      .from(schema.requestRecipients)
      .where(eq(schema.requestRecipients.requestId, requestId));
    const ann = recips.find((r) => r.name === 'Ann Artist')!;
    const ben = recips.find((r) => r.name === 'Ben Venue')!;
    expect(ann.signedAt!.getTime()).toBeGreaterThanOrEqual(a.before - 5000);
    expect(ann.signedAt!.getUTCFullYear()).not.toBe(1999);

    const signed = pdfContent(
      (await readRequestFile(db, storage, { userId: owner }, requestId, 'signed')).bytes,
    );
    expect(ann).toMatchObject({ timeZone: 'America/Los_Angeles', timeZoneSource: 'device' });
    expect(ben).toMatchObject({ timeZone: 'Asia/Tokyo', timeZoneSource: 'ip' });
    // Each stamp shows that signer's own time zone, not the sender's.
    expect(signed).toContain(pdfHex(formatSigningTime(ann.signedAt!, 'America/Los_Angeles')));
    expect(signed).toContain(pdfHex(formatSigningTime(ben.signedAt!, 'Asia/Tokyo')));
    expect(signed).not.toContain(pdfHex(formatSigningTime(ann.signedAt!, 'America/New_York')));
    expect(signed).toContain(pdfHex('Ann Artist'));
    expect(signed).not.toContain(pdfHex('Mallory'));
    expect(signed).not.toContain(pdfHex('1999'));

    // The certificate shows each recipient's signing event, matching the evidence chain.
    const seals = await getSignatureSeals(db, { userId: owner }, docId, requestId);
    expect(seals!.fields).toHaveLength(2);
    const annSeal = seals!.fields.find((f) => f.signerName === 'Ann Artist')!;
    expect(annSeal.signedAt).toBe(ann.signedAt!.toISOString());
    const [ev] = await owner_.db
      .select()
      .from(schema.signingEvents)
      .where(eq(schema.signingEvents.recipientId, ann.id));
    const events = await owner_.db
      .select()
      .from(schema.signingEvents)
      .where(eq(schema.signingEvents.requestId, requestId));
    const signedEv = events.find((e) => e.recipientId === ann.id && e.type === 'recipient.signed')!;
    expect(ev).toBeTruthy();
    expect(annSeal.eventRef).toBe(`EV-${signedEv.seq}-${signedEv.hash.slice(0, 12).toUpperCase()}`);
    const cert = pdfContent(
      (await readRequestFile(db, storage, { userId: owner }, requestId, 'certificate')).bytes,
    );
    expect(cert).toContain(pdfHex(annSeal.eventRef!));
    // The certificate's signer rows use each signer's zone too; the event recorded it.
    expect(cert).toContain(pdfHex(formatCertTime(ann.signedAt!, 'America/Los_Angeles').time));
    expect(signedEv.data).toMatchObject({
      timeZone: 'America/Los_Angeles',
      timeZoneSource: 'device',
    });
  });

  it('only shows seal details to people who can open the document', async () => {
    await expect(
      getSignatureSeals(db, { userId: outsider }, docId, requestId),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
