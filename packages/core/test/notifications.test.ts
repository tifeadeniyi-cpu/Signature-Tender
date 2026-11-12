import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
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
  startSigning,
  getSignerView,
  giveConsent,
  getSigningWorkspace,
  adoptSignature,
  completeSigning,
  finalizeRequest,
  declineSigning,
  cancelRequest,
  getDocumentRecord,
  startRetrieval,
  verifyRetrieval,
  readRetrievedFile,
  getRetrievedRequest,
  dispatchDueNotifications,
  resolveNotificationLink,
  renewNotificationLink,
  revokeNotificationLinks,
  recordProviderEvent,
  notificationLinkToken,
  maskEmail,
  TransientEmailError,
  hashSecret,
  MemoryStorage,
  type CompletedPayload,
  type NotificationTransport,
  type OutgoingNotificationEmail,
  type ClaimedNotification,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const TEST = { mode: 'test' as const, testSigningEnabled: true };
const RUN = Date.now().toString(36);
const SECRET = 'test-link-secret-0123456789abcdef0123456789';
let owner: string, outsider: string, ws: string, senderEmail: string;

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

const addr = (who: string) => `${who}-${RUN}@example.test`;

/** Two signers (parallel) and a copy recipient on a fictional 3-page agreement. */
async function sentRequest(title: string, extra: { email: string; name: string }[] = []) {
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
      bytes: await makePdf(3),
    },
    { maxBytes: 5 * 1024 * 1024, maxPages: 10 },
  );
  const recipients = [
    { name: 'Ada Artist', email: addr('ada'), role: 'signer' as const, signingOrder: 1 },
    { name: 'Bo Booker', email: addr('bo'), role: 'signer' as const, signingOrder: 1 },
    { name: 'Cy Copy', email: addr('cy'), role: 'cc' as const, signingOrder: 2 },
    ...extra.map((e) => ({ ...e, role: 'signer' as const, signingOrder: 1 })),
  ].map((r) => ({ ...r, authMethod: 'email_link' as const }));
  await saveRecipients(
    db,
    actor,
    id,
    { signingOrderEnabled: false, recipients },
    { maxSigners: 5 },
  );
  const d = await getDocument(db, actor, id);
  await saveFields(
    db,
    actor,
    id,
    d.recipients
      .filter((r) => r.role === 'signer')
      .map((r) => ({
        recipientId: r.id,
        type: 'signature' as const,
        page: 1,
        x: 0.1,
        y: 0.7,
        width: 0.3,
        height: 0.06,
      })),
  );
  expect(await markReadyToSend(db, actor, id)).toEqual([]);
  const sent = await sendForSignature(db, storage, actor, id, TEST);
  const tokens = Object.fromEntries(sent.invitations.map((i) => [i.email, i.token]));
  return { docId: id, requestId: sent.requestId, tokens };
}

async function sign(token: string) {
  const { session } = (await startSigning(db, token)) as { session: string };
  const v = await getSignerView(db, token, session);
  await giveConsent(db, token, session, { disclosureVersion: v.disclosure.version, agree: true });
  const wsp = await getSigningWorkspace(db, token, session);
  const sig = await adoptSignature(db, token, session, {
    kind: 'signature',
    method: 'drawn',
    pngBase64: png(),
  });
  return completeSigning(db, storage, token, session, {
    intent: true,
    values: [{ fieldId: wsp.fields.find((f) => f.type === 'signature')!.id, signatureId: sig.id }],
  });
}

async function rowsFor(requestId: string) {
  return owner_.db
    .select()
    .from(schema.notifications)
    .where(sql`${schema.notifications.requestId} = ${requestId}::uuid`);
}

async function verifiedSession(email: string) {
  const s = await startRetrieval(db, email, {
    ipAddress: `10.7.${Math.floor(Math.random() * 250)}.1`,
  });
  return verifyRetrieval(db, s.sessionId, email, s.code!);
}

class FakeTransport implements NotificationTransport {
  sent: { msg: OutgoingNotificationEmail; key: string }[] = [];
  failNext: Error[] = [];
  async send(msg: OutgoingNotificationEmail, opts: { idempotencyKey: string }) {
    const err = this.failNext.shift();
    if (err) throw err;
    this.sent.push({ msg, key: opts.idempotencyKey });
    return { providerMessageId: `msg_${this.sent.length}_${RUN}` };
  }
}
/** Minimal renderer: the real template lives in the web app; here we only need the link. */
const render = (n: ClaimedNotification): OutgoingNotificationEmail => ({
  to: n.row.toEmail,
  subject: `Your Document Is Complete — ${(n.row.payload as unknown as CompletedPayload).documentName}`,
  text: n.linkToken ? `https://app.test/retrieve/link/${n.linkToken}` : 'https://app.test/app',
  html: '<p>hi</p>',
});
const dispatch = (transport: NotificationTransport, requestId: string) =>
  dispatchDueNotifications(db, { transport, render, linkSecret: SECRET }, { requestId });

beforeAll(async () => {
  owner = await makeUser('notif_sender');
  outsider = await makeUser('notif_outsider');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Notify Studio' })).id;
  const [u] = await owner_.db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(sql`${schema.user.id} = ${owner}`);
  senderEmail = u!.email;
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('completion notifications are queued only after valid finalization', () => {
  let ctx: Awaited<ReturnType<typeof sentRequest>>;

  it('queues nothing while a required signature is outstanding', async () => {
    ctx = await sentRequest('Artist Management Agreement');
    const first = await sign(ctx.tokens[addr('ada')]!);
    expect(first.readyToFinalize).toBe(false);
    expect(await rowsFor(ctx.requestId)).toHaveLength(0);
    // Nobody can queue one by hand before completion, even the sender.
    await expect(
      withSigner(db, hashSecret(ctx.tokens[addr('ada')]!), (tx) =>
        tx.insert(schema.notifications).values({
          workspaceId: ws,
          requestId: ctx.requestId,
          documentId: ctx.docId,
          template: 'document_completed',
          templateVersion: 'x',
          audience: 'recipient',
          toEmail: 'attacker@example.test',
          toName: 'x',
          payload: {},
        }),
      ),
    ).rejects.toThrow();
  });

  it('queues one email per sender and recipient once finalization succeeds', async () => {
    const last = await sign(ctx.tokens[addr('bo')]!);
    expect(last.readyToFinalize).toBe(true);
    await finalizeRequest(db, storage, { token: ctx.tokens[addr('bo')]! }, ctx.requestId);
    const rows = await rowsFor(ctx.requestId);
    expect(rows.map((r) => `${r.audience}:${r.toEmail}`).sort()).toEqual(
      [
        `recipient:${addr('ada')}`,
        `recipient:${addr('bo')}`,
        `recipient:${addr('cy')}`,
        `sender:${senderEmail}`,
      ].sort(),
    );
    const [req] = await owner_.db
      .select()
      .from(schema.signingRequests)
      .where(sql`${schema.signingRequests.id} = ${ctx.requestId}::uuid`);
    const p = rows.find((r) => r.toEmail === addr('cy'))!.payload as unknown as CompletedPayload;
    expect(p).toMatchObject({
      documentName: 'Artist Management Agreement',
      documentReference: ctx.requestId,
      documentPageCount: 3,
      completedSignerCount: 2,
      requiredSignerCount: 2,
      senderName: 'notif_sender',
      senderEmail,
      workspaceName: 'Notify Studio',
      recipientName: 'Cy Copy',
      isTest: true,
      allowDownload: true,
      signedFileId: req!.signedFileId,
      certificateFileId: req!.certificateFileId,
    });
    expect(new Date(p.completedAt).getTime()).toBe(req!.completedAt!.getTime());
    // The log never holds link tokens: none are issued until the dispatcher claims the row.
    expect(rows.every((r) => r.status === 'queued' && r.linkHash === null)).toBe(true);
    for (const t of Object.values(ctx.tokens)) expect(JSON.stringify(rows)).not.toContain(t);
  });

  it('does not queue duplicates when completion is processed again', async () => {
    await finalizeRequest(db, storage, { actor: { userId: owner } }, ctx.requestId);
    expect(await rowsFor(ctx.requestId)).toHaveLength(4);
  });

  it('sends each recipient their own email with their own link; senders get none', async () => {
    const t = new FakeTransport();
    const res = await dispatch(t, ctx.requestId);
    expect(res.map((r) => r.status)).toEqual(['sent', 'sent', 'sent', 'sent']);
    expect(t.sent.map((s) => s.msg.to).sort()).toEqual(
      [addr('ada'), addr('bo'), addr('cy'), senderEmail].sort(),
    );
    const rows = await rowsFor(ctx.requestId);
    expect(rows.every((r) => r.status === 'sent' && r.sentAt && r.providerMessageId)).toBe(true);
    const sender = rows.find((r) => r.audience === 'sender')!;
    expect(sender.linkHash).toBeNull();
    const links = new Set(t.sent.map((s) => s.msg.text));
    expect(links.size).toBe(4);
    // Stored as a hash only.
    const ada = t.sent.find((s) => s.msg.to === addr('ada'))!;
    const token = ada.msg.text.split('/').at(-1)!;
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows.find((r) => r.toEmail === addr('ada'))!.linkHash).toBe(hashSecret(token));
    // Nothing left to send.
    expect(await dispatch(t, ctx.requestId)).toEqual([]);
  });

  it('resolves a link to its recipient, and the activity log shows the emails', async () => {
    const rows = await rowsFor(ctx.requestId);
    const ada = rows.find((r) => r.toEmail === addr('ada'))!;
    const token = notificationLinkToken(SECRET, ada.id, ada.linkVersion);
    expect(await resolveNotificationLink(db, token)).toMatchObject({
      requestId: ctx.requestId,
      audience: 'recipient',
      email: addr('ada'),
      expired: false,
      revoked: false,
    });
    expect(await resolveNotificationLink(db, 'A'.repeat(43))).toBeNull();
    expect(await resolveNotificationLink(db, 'not a token')).toBeNull();
    expect(maskEmail('kit@example.test')).toBe('k••@example.test');

    const rec = await getDocumentRecord(db, { userId: owner }, ctx.docId);
    const emails = rec.activity.filter((a) => a.source === 'email');
    expect(emails.filter((a) => a.type === 'email.sent')).toHaveLength(4);
    expect(emails.find((a) => a.recipientName === 'Ada Artist')?.data.template).toBe(
      'document_completed',
    );
    // People outside the workspace see nothing.
    await expect(getDocumentRecord(db, { userId: outsider }, ctx.docId)).rejects.toMatchObject({
      code: 'not_found',
    });
    const [{ n }] = (await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${outsider}, true)`);
      return tx.execute(sql`select count(*)::int as n from notifications`);
    })) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});

describe('secure retrieval behind the email links', () => {
  let ctx: Awaited<ReturnType<typeof sentRequest>>;

  beforeAll(async () => {
    ctx = await sentRequest('Venue Rider');
    await sign(ctx.tokens[addr('ada')]!);
    await sign(ctx.tokens[addr('bo')]!);
    await finalizeRequest(db, storage, { token: ctx.tokens[addr('bo')]! }, ctx.requestId);
    await dispatch(new FakeTransport(), ctx.requestId);
  });

  it('lets the verified recipient view and download, and records each access', async () => {
    const session = await verifiedSession(addr('cy'));
    const view = await getRetrievedRequest(db, session, ctx.requestId);
    expect(view.request.status).toBe('completed');
    expect(view.canOpenFiles).toBe(true);
    expect(view.files.map((f) => f.kind).sort()).toEqual(['certificate', 'signed']);
    expect(view.signers.map((s) => `${s.name}:${s.role}:${s.status}`).sort()).toEqual([
      'Ada Artist:signer:signed',
      'Bo Booker:signer:signed',
      'Cy Copy:cc:waiting',
    ]);
    expect(JSON.stringify(view.signers)).not.toContain('@');
    expect(view.events.map((e) => e.type)).toContain('request.completed');

    const signed = await readRetrievedFile(
      db,
      storage,
      session,
      ctx.requestId,
      'signed',
      {},
      'view',
    );
    expect(Buffer.from(signed.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const cert = await readRetrievedFile(db, storage, session, ctx.requestId, 'certificate');
    expect(Buffer.from(cert.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const events = await owner_.db
      .select()
      .from(schema.signingEvents)
      .where(sql`${schema.signingEvents.requestId} = ${ctx.requestId}::uuid`);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['recipient.viewed_copy', 'recipient.retrieved']),
    );
  });

  it('a forwarded email does not open the agreement for someone else', async () => {
    // Someone who received a forwarded link can only verify their own inbox, which has no access.
    const stranger = addr('stranger');
    const s = await startRetrieval(db, stranger, { ipAddress: '10.8.0.1' });
    expect(s.code).toBeNull();
    // Even a verified session for a different recipient's own address cannot reach this request.
    const otherCtx = await sentRequest('Unrelated Deal', [{ email: addr('dee'), name: 'Dee' }]);
    const dee = await verifiedSession(addr('dee'));
    await expect(getRetrievedRequest(db, dee, ctx.requestId)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      readRetrievedFile(db, storage, dee, ctx.requestId, 'signed'),
    ).rejects.toMatchObject({ code: 'not_found' });
    // And no session at all is refused.
    await expect(
      readRetrievedFile(db, storage, undefined, ctx.requestId, 'signed'),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    // Renewing a link needs a session for the address the link was sent to.
    const rows = await rowsFor(ctx.requestId);
    const ada = rows.find((r) => r.toEmail === addr('ada'))!;
    const adaToken = notificationLinkToken(SECRET, ada.id, ada.linkVersion);
    await expect(renewNotificationLink(db, dee, adaToken)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(otherCtx.requestId).not.toBe(ctx.requestId);
  });

  it('expired links need re-verification and renewal invalidates the old link', async () => {
    const rows = await rowsFor(ctx.requestId);
    const ada = rows.find((r) => r.toEmail === addr('ada'))!;
    const oldToken = notificationLinkToken(SECRET, ada.id, ada.linkVersion);
    await owner_.db
      .update(schema.notifications)
      .set({ linkExpiresAt: new Date(Date.now() - 1000) })
      .where(sql`${schema.notifications.id} = ${ada.id}::uuid`);
    expect((await resolveNotificationLink(db, oldToken))?.expired).toBe(true);
    await expect(renewNotificationLink(db, undefined, oldToken)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const session = await verifiedSession(addr('ada'));
    await renewNotificationLink(db, session, oldToken);
    expect(await resolveNotificationLink(db, oldToken)).toBeNull();
    const t = new FakeTransport();
    const res = await dispatch(t, ctx.requestId);
    expect(res).toEqual([{ id: ada.id, status: 'sent' }]);
    const newToken = t.sent[0]!.msg.text.split('/').at(-1)!;
    expect(newToken).not.toBe(oldToken);
    expect(await resolveNotificationLink(db, newToken)).toMatchObject({ expired: false });
  });

  it('the sender can revoke links, after which they cannot be renewed', async () => {
    await expect(revokeNotificationLinks(db, { userId: outsider }, ctx.requestId)).resolves.toBe(0);
    expect(await revokeNotificationLinks(db, { userId: owner }, ctx.requestId)).toBeGreaterThan(0);
    const [bo] = (await rowsFor(ctx.requestId)).filter((r) => r.toEmail === addr('bo'));
    const token = notificationLinkToken(SECRET, bo!.id, bo!.linkVersion);
    expect((await resolveNotificationLink(db, token))?.revoked).toBe(true);
    const session = await verifiedSession(addr('bo'));
    await expect(renewNotificationLink(db, session, token)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('no completion email for requests that did not complete', () => {
  it('declined, cancelled and failed finalization queue nothing', async () => {
    const declined = await sentRequest('Declined Deal');
    const { session } = (await startSigning(db, declined.tokens[addr('ada')]!)) as {
      session: string;
    };
    await declineSigning(db, declined.tokens[addr('ada')]!, session, 'Wrong fee');
    expect(await rowsFor(declined.requestId)).toHaveLength(0);

    const cancelled = await sentRequest('Cancelled Deal');
    await sign(cancelled.tokens[addr('ada')]!);
    await cancelRequest(db, { userId: owner }, cancelled.requestId, 'Changed plans');
    expect(await rowsFor(cancelled.requestId)).toHaveLength(0);

    // Finalization fails when the stored original no longer matches its recorded hash.
    const broken = await sentRequest('Broken Deal');
    await sign(broken.tokens[addr('ada')]!);
    await sign(broken.tokens[addr('bo')]!);
    const [req] = await owner_.db
      .select()
      .from(schema.signingRequests)
      .where(sql`${schema.signingRequests.id} = ${broken.requestId}::uuid`);
    const [file] = await owner_.db
      .select()
      .from(schema.documentFiles)
      .where(sql`${schema.documentFiles.id} = ${req!.sourceFileId}::uuid`);
    const original = await storage.get(file!.storageKey);
    await storage.put(file!.storageKey, await makePdf(1), 'application/pdf');
    await expect(
      finalizeRequest(db, storage, { actor: { userId: owner } }, broken.requestId),
    ).rejects.toThrow(/integrity/);
    expect(await rowsFor(broken.requestId)).toHaveLength(0);
    await storage.put(file!.storageKey, original, 'application/pdf');
  });
});

describe('delivery failures and provider events', () => {
  let ctx: Awaited<ReturnType<typeof sentRequest>>;

  beforeAll(async () => {
    ctx = await sentRequest('Tour Contract');
    await sign(ctx.tokens[addr('ada')]!);
    await sign(ctx.tokens[addr('bo')]!);
    await finalizeRequest(db, storage, { token: ctx.tokens[addr('bo')]! }, ctx.requestId);
  });

  it('retries transient provider errors with the same message and idempotency key', async () => {
    const t = new FakeTransport();
    t.failNext = [new TransientEmailError('rate limited')];
    const first = await dispatchDueNotifications(
      db,
      { transport: t, render, linkSecret: SECRET },
      { requestId: ctx.requestId, limit: 1 },
    );
    expect(first[0]).toMatchObject({ status: 'retrying', error: 'rate limited' });
    const [row] = (await rowsFor(ctx.requestId)).filter((r) => r.id === first[0]!.id);
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(row!.attempts).toBe(1);
    // Not due yet: nothing is sent early.
    const later = await dispatch(t, ctx.requestId);
    expect(later.map((r) => r.id)).not.toContain(row!.id);
    await owner_.db
      .update(schema.notifications)
      .set({ nextAttemptAt: new Date(Date.now() - 1000) })
      .where(sql`${schema.notifications.id} = ${row!.id}::uuid`);
    const retried = await dispatch(t, ctx.requestId);
    expect(retried).toEqual([{ id: row!.id, status: 'sent' }]);
    const keys = t.sent.filter((s) => s.key.includes(row!.id)).map((s) => s.key);
    expect(keys).toEqual([`notification-${row!.id}-v1`]);
    const [done] = (await rowsFor(ctx.requestId)).filter((r) => r.id === row!.id);
    expect(done).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
  });

  it('marks permanent errors failed, and records delivery and bounces from the provider', async () => {
    const extra = await sentRequest('Merch Deal');
    await sign(extra.tokens[addr('ada')]!);
    await sign(extra.tokens[addr('bo')]!);
    await finalizeRequest(db, storage, { token: extra.tokens[addr('bo')]! }, extra.requestId);
    const t = new FakeTransport();
    t.failNext = [new Error('Invalid recipient address')];
    const res = await dispatch(t, extra.requestId);
    expect(res.filter((r) => r.status === 'failed')).toHaveLength(1);
    expect(res.filter((r) => r.status === 'sent')).toHaveLength(3);
    const rows = await rowsFor(extra.requestId);
    const failed = rows.find((r) => r.status === 'failed')!;
    expect(failed.failedAt).toBeTruthy();
    expect(failed.lastError).toContain('Invalid recipient');

    const [delivered, bounced] = rows.filter((r) => r.status === 'sent');
    expect(
      await recordProviderEvent(db, {
        type: 'email.delivered',
        messageId: delivered!.providerMessageId!,
        at: new Date(),
      }),
    ).toBe(true);
    await recordProviderEvent(db, {
      type: 'email.bounced',
      messageId: bounced!.providerMessageId!,
      at: new Date(),
      reason: 'Mailbox does not exist',
    });
    // A late delivered event does not overwrite the bounce.
    await recordProviderEvent(db, {
      type: 'email.delivered',
      messageId: bounced!.providerMessageId!,
      at: new Date(),
    });
    expect(
      await recordProviderEvent(db, {
        type: 'email.delivered',
        messageId: 'unknown',
        at: new Date(),
      }),
    ).toBe(false);
    const after = await rowsFor(extra.requestId);
    expect(after.find((r) => r.id === delivered!.id)).toMatchObject({ status: 'delivered' });
    expect(after.find((r) => r.id === delivered!.id)!.deliveredAt).toBeTruthy();
    expect(after.find((r) => r.id === bounced!.id)).toMatchObject({
      status: 'bounced',
      lastError: 'Mailbox does not exist',
    });
  });

  it('parallel dispatchers never send the same email twice, even while the request is busy', async () => {
    const extra = await sentRequest('Parallel Deal');
    await sign(extra.tokens[addr('ada')]!);
    await sign(extra.tokens[addr('bo')]!);
    await finalizeRequest(db, storage, { token: extra.tokens[addr('bo')]! }, extra.requestId);
    const t = new FakeTransport();
    // Signing traffic locks the request and recipient rows while two dispatchers run.
    const busy = db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${owner}, true)`);
      await tx.execute(
        sql`select id from signing_requests where id = ${extra.requestId}::uuid for update`,
      );
      await new Promise((r) => setTimeout(r, 300));
    });
    const [a, b] = await Promise.all([
      dispatch(t, extra.requestId),
      dispatch(t, extra.requestId),
      busy,
    ]);
    expect([...a!, ...b!].filter((r) => r.status === 'sent')).toHaveLength(4);
    expect(new Set(t.sent.map((s) => s.msg.to)).size).toBe(4);
    expect(t.sent).toHaveLength(4);
  });

  it('gives up after the maximum number of attempts', async () => {
    const extra = await sentRequest('Final Attempt Deal');
    await sign(extra.tokens[addr('ada')]!);
    await sign(extra.tokens[addr('bo')]!);
    await finalizeRequest(db, storage, { token: extra.tokens[addr('bo')]! }, extra.requestId);
    const [row] = await rowsFor(extra.requestId);
    await owner_.db
      .update(schema.notifications)
      .set({ attempts: 5 })
      .where(sql`${schema.notifications.id} = ${row!.id}::uuid`);
    const t = new FakeTransport();
    t.failNext = [new TransientEmailError('provider down')];
    const res = await dispatchDueNotifications(
      db,
      { transport: t, render, linkSecret: SECRET },
      { requestId: extra.requestId, limit: 1 },
    );
    expect(res[0]).toMatchObject({ id: row!.id, status: 'failed' });
  });
});
