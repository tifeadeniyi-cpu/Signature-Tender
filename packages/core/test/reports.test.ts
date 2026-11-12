import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '@st/db';
import {
  createWorkspace,
  createDocumentFromUpload,
  saveRecipients,
  saveFields,
  markReadyToSend,
  getDocument,
  sendForSignature,
  cancelRequest,
  MemoryStorage,
  getWorkspaceReport,
  exportReportCsv,
  defaultRange,
  createApiKey,
  hitRateLimit,
  deriveSecretsKey,
  connectIntegration,
  disconnectIntegration,
  dispatchWebhooks,
  listWebhookDeliveries,
  slackMessage,
  validateSlackWebhookUrl,
  isPlatformAdmin,
  hasStrongSignIn,
  getAdminOverview,
  listAdminWorkspaces,
  getAdminOperations,
} from '../src';
import { APP_URL, OWNER_URL } from './env';
import { makeUser, addMember, makePdf } from './helpers';

const { db, close } = createDb(APP_URL, { max: 4 });
const owner_ = createDb(OWNER_URL, { max: 1 });
const storage = new MemoryStorage();
const TEST = { mode: 'test' as const, testSigningEnabled: true };
const ctx = {
  encKey: deriveSecretsKey('r'.repeat(40)),
  urlPolicy: { resolve: async () => ['93.184.216.34'] },
};
const SLACK = 'https://hooks.slack.com/services/T000/B000/abcDEF123';
const range = defaultRange(30);

let owner: string, viewer: string, staff: string, ws: string;

async function sendDoc(actorId: string, title: string) {
  const actor = { userId: actorId };
  const { id } = await createDocumentFromUpload(
    db,
    storage,
    actor,
    { workspaceId: ws, title, documentType: 'booking', filename: 'r.pdf', bytes: await makePdf(1) },
    { maxBytes: 5_000_000, maxPages: 10 },
  );
  await saveRecipients(
    db,
    actor,
    id,
    {
      signingOrderEnabled: false,
      recipients: [
        {
          name: 'Rae',
          email: 'rae@example.test',
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
  await markReadyToSend(db, actor, id);
  return sendForSignature(db, storage, actor, id, TEST);
}

beforeAll(async () => {
  owner = await makeUser('rep_owner');
  viewer = await makeUser('rep_creator');
  staff = await makeUser('rep_staff');
  ws = (await createWorkspace(db, { userId: owner }, { name: 'Report WS' })).id;
  await addMember(ws, viewer, 'editor');
});
afterAll(async () => {
  await close();
  await owner_.close();
});

describe('workspace reports', () => {
  it('counts requests, outcomes and recipients, and hides tests unless asked', async () => {
    await sendDoc(owner, 'One');
    const { requestId } = await sendDoc(owner, '=HYPERLINK("http://evil")');
    await cancelRequest(db, { userId: owner }, requestId, 'Not needed');
    await sendDoc(owner, 'Three');

    const live = await getWorkspaceReport(db, { userId: owner }, ws, range);
    expect(live.totals.sent).toBe(0);

    const r = await getWorkspaceReport(db, { userId: owner }, ws, range, { includeTests: true });
    expect(r.totals).toMatchObject({ sent: 3, cancelled: 1, open: 2 });
    expect(r.completionRate).toBe(0);
    expect(r.byType[0]).toMatchObject({ documentType: 'booking', sent: 3 });
    expect(r.recipients.total).toBe(3);
    expect(r.byMonth.reduce((s, m) => s + m.sent, 0)).toBe(3);
    expect(r.credits).not.toBeNull();
    expect(r.api).not.toBeNull();
  });

  it('limits a member to what they can see and hides billing and API sections', async () => {
    const r = await getWorkspaceReport(db, { userId: viewer }, ws, range, { includeTests: true });
    // An editor sees only documents they created, so none of the owner's requests.
    expect(r.totals.sent).toBe(0);
    expect(r.bySender).toEqual([]);
    expect(r.credits).toBeNull();
    expect(r.api).toBeNull();
    const outsider = await makeUser('rep_out');
    await expect(getWorkspaceReport(db, { userId: outsider }, ws, range)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('exports CSV with formula cells neutralised', async () => {
    const csv = await exportReportCsv(db, { userId: owner }, ws, range, { includeTests: true });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('request_id,title');
    expect(lines).toHaveLength(4);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).not.toContain('rae@example.test');
  });

  it('rejects bad ranges', async () => {
    await expect(
      getWorkspaceReport(db, { userId: owner }, ws, { from: '2026-02-01', to: '2026-01-01' }),
    ).rejects.toThrow(/before/);
  });

  it('counts API calls per day', async () => {
    const k = await createApiKey(db, { userId: owner }, ws, {
      name: 'Usage',
      scopes: ['documents:read'],
    });
    for (let i = 0; i < 3; i++) await hitRateLimit(db, k.id, 100);
    await db.transaction((tx) => tx.execute(sql`select st_api_usage_error(${k.id}::uuid)`));
    const r = await getWorkspaceReport(db, { userId: owner }, ws, range);
    const today = r.api!.at(-1)!;
    expect(today.calls).toBeGreaterThanOrEqual(3);
    expect(today.errors).toBeGreaterThanOrEqual(1);
  });
});

describe('Slack connector', () => {
  it('accepts only Slack incoming webhook URLs', () => {
    expect(validateSlackWebhookUrl(SLACK).hostname).toBe('hooks.slack.com');
    for (const bad of [
      'http://hooks.slack.com/services/T/B/C',
      'https://hooks.slack.com.evil.test/services/T/B/C',
      'https://example.com/services/T/B/C',
      'https://hooks.slack.com/other',
    ])
      expect(() => validateSlackWebhookUrl(bad)).toThrow(/Slack/);
  });

  it('writes plain messages with a link and no emails, escaping titles', () => {
    const m = slackMessage(
      'recipient.signed',
      { title: '<b>Deal</b> & co', document_id: 'd1', test: true, recipient_email: 'x@y.test' },
      'https://app.test',
    );
    expect(m.text).toBe(
      '[TEST] *&lt;b&gt;Deal&lt;/b&gt; &amp; co* was signed by a recipient. <https://app.test/app/documents/d1|Open in Signature Tender>',
    );
    expect(m.text).not.toContain('x@y.test');
  });

  it('connects, posts Slack-format messages through the delivery queue, and disconnects', async () => {
    await expect(
      connectIntegration(
        db,
        { userId: owner },
        ws,
        { provider: 'slack', webhookUrl: 'https://example.com/x' },
        ctx,
      ),
    ).rejects.toThrow(/Slack/);
    await expect(
      connectIntegration(db, { userId: owner }, ws, { provider: 'slack' }, ctx),
    ).rejects.toMatchObject({ code: 'invalid' });
    const res = await connectIntegration(
      db,
      { userId: owner },
      ws,
      { provider: 'slack', webhookUrl: SLACK },
      ctx,
    );
    expect(res).toEqual({ apiKey: null, webhookSecret: null });

    await sendDoc(owner, 'Slack me');
    const bodies: { url: string; body: string; headers: Headers }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      bodies.push({ url, body: String(init.body), headers: new Headers(init.headers) });
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    await dispatchWebhooks(db, { ...ctx, appUrl: 'https://app.test', fetch: fakeFetch });
    const slack = bodies.filter((b) => b.url === SLACK);
    expect(slack.length).toBeGreaterThan(0);
    const msgs = slack.map((b) => JSON.parse(b.body));
    expect(msgs.every((m) => Object.keys(m).join() === 'text')).toBe(true);
    expect(msgs.some((m) => m.text.startsWith('Signature Tender is connected'))).toBe(true);
    expect(msgs.some((m) => m.text.includes('*Slack me* was sent for signature'))).toBe(true);
    expect(slack[0]!.headers.get('Signature-Tender-Signature')).toBeNull();
    const log = await listWebhookDeliveries(db, { userId: owner }, ws);
    expect(log.some((d) => d.url.endsWith('/services/••••') && d.status === 'succeeded')).toBe(
      true,
    );
    expect(JSON.stringify(log)).not.toContain('abcDEF123');

    await disconnectIntegration(db, { userId: owner }, ws, 'slack');
    const after = await listWebhookDeliveries(db, { userId: owner }, ws);
    expect(after.some((d) => d.url.endsWith('/services/••••'))).toBe(false);
  });
});

describe('internal administration', () => {
  it('is closed to everyone not on the staff list, including workspace owners', async () => {
    expect(await isPlatformAdmin(db, { userId: owner })).toBe(false);
    await expect(getAdminOverview(db, { userId: owner })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(listAdminWorkspaces(db, { userId: owner })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(getAdminOperations(db, { userId: owner })).rejects.toMatchObject({
      code: 'forbidden',
    });
    // The app role cannot add itself.
    await expect(
      db.execute(sql`insert into platform_admins (user_id) values (${owner})`),
    ).rejects.toThrow();
  });

  it('gives staff counts and ids only, and records each view', async () => {
    await owner_.db.execute(
      sql`insert into platform_admins (user_id, note) values (${staff}, 'test')`,
    );
    expect(await isPlatformAdmin(db, { userId: staff })).toBe(true);
    const o = await getAdminOverview(db, { userId: staff });
    expect(o.workspaces).toBeGreaterThan(0);
    expect(o.test_requests_30d).toBeGreaterThan(0);
    const list = await listAdminWorkspaces(db, { userId: staff }, 'Report WS');
    expect(list[0]).toMatchObject({ id: ws, name: 'Report WS', members: 2 });
    expect(list[0]!.test_requests).toBeGreaterThan(0);
    const like = await listAdminWorkspaces(db, { userId: staff }, '%');
    expect(like.every((w) => w.name.includes('%'))).toBe(true);
    const ops = await getAdminOperations(db, { userId: staff });
    expect(ops.feature_flags.map((f) => f.key)).toContain('production_signing');
    expect(JSON.stringify([o, list, ops])).not.toContain('rae@example.test');
    const views = (await owner_.db.execute(
      sql`select target_id from audit_events where actor_user_id = ${staff} and action = 'admin.viewed'`,
    )) as unknown as { target_id: string }[];
    expect(views.map((v) => v.target_id).sort()).toEqual([
      'operations',
      'overview',
      'workspaces',
      'workspaces',
    ]);
  });

  it('requires two-factor sign-in or a passkey before staff count as strongly signed in', async () => {
    expect(await hasStrongSignIn(db, staff)).toBe(false);
    await owner_.db.execute(sql`update "user" set two_factor_enabled = true where id = ${staff}`);
    expect(await hasStrongSignIn(db, staff)).toBe(true);
    await owner_.db.execute(sql`update "user" set two_factor_enabled = false where id = ${staff}`);
  });
});
