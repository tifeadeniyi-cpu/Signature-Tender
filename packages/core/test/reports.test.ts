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
  getAdminAccess,
  recordAdminDenied,
  listAdminAudit,
  listAdminStaff,
  getCommandCenter,
  resolvePeriod,
  pctChange,
  getPerfGrowth,
  getPerfEngagement,
  getPerfFeatures,
  getPerfConversion,
  getPerfDelivery,
  buildInsights,
  perfCsv,
  ppChange,
  parsePerfTab,
  getPerfMeasurement,
  measurementCsv,
  minutesPerDay,
  classifySource,
  pageGroup,
  recordVisit,
  recordSignupSource,
  recordActiveTime,
  pruneMeasurement,
  linkStripeCustomer,
  applySubscription,
  applyInvoice,
  invoiceLifecycleKind,
  type CommandCenter,
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

describe('admin roles and the audit trail', () => {
  it('limits each role to its permissions, in the database as well as the app', async () => {
    const analyst = await makeUser('rep_analyst');
    const founder = await makeUser('rep_founder');
    await owner_.db.execute(sql`insert into platform_admins (user_id) values (${analyst})`);
    await owner_.db.execute(
      sql`insert into platform_admins (user_id, role) values (${founder}, 'founder')`,
    );
    // A grant without a role gets read-only analytics.
    expect(await getAdminAccess(db, { userId: analyst })).toEqual({
      role: 'analyst',
      permissions: ['analytics.view'],
    });
    expect((await getAdminAccess(db, { userId: founder })).permissions).toContain('audit.view');
    expect(await getAdminAccess(db, { userId: owner })).toEqual({ role: null, permissions: [] });
    // Direct calls are refused too, not just hidden in the UI.
    await expect(listAdminAudit(db, { userId: analyst })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(listAdminStaff(db, { userId: analyst })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(listAdminAudit(db, { userId: owner })).rejects.toMatchObject({
      code: 'forbidden',
    });
    // An invalid role cannot be stored.
    await expect(
      owner_.db.execute(sql`update platform_admins set role = 'god' where user_id = ${analyst}`),
    ).rejects.toThrow();

    await recordAdminDenied(db, { userId: owner }, '/admin/audit', 'audit.view');
    const log = await listAdminAudit(db, { userId: founder }, { q: 'admin.access_denied' });
    const denied = log.rows.find((r) => r.actor_role === 'customer');
    expect(denied).toMatchObject({ category: 'security', risk: 'high', outcome: 'denied' });
    // Customers appear only as an opaque reference, with no details.
    expect(denied!.actor).toMatch(/^User [0-9A-F]{8}$/);
    expect(denied!.details).toEqual({});
    expect(JSON.stringify(log.rows)).not.toContain(owner);
    const staffRows = await listAdminStaff(db, { userId: founder });
    expect(staffRows.find((r) => r.user_id === founder)).toMatchObject({ role: 'founder' });
  });

  it('keeps the audit log append-only, even for the database owner', async () => {
    const refused = async (q: Promise<unknown>) => {
      const err = await q.then(
        () => null,
        (e: Error & { cause?: Error }) => e,
      );
      expect(String(err?.cause?.message ?? err?.message)).toMatch(/append-only/);
    };
    const [row] = (await owner_.db.execute(
      sql`select id from audit_events order by seq desc limit 1`,
    )) as unknown as { id: string }[];
    await refused(
      owner_.db.execute(sql`update audit_events set action = 'x' where id = ${row!.id}`),
    );
    await refused(owner_.db.execute(sql`delete from audit_events where id = ${row!.id}`));
    await refused(owner_.db.execute(sql`truncate audit_events`));
    await expect(db.execute(sql`delete from audit_events where id = ${row!.id}`)).rejects.toThrow();
  });
});

describe('command center', () => {
  it('resolves periods in UTC with an equal-length comparison', () => {
    const now = new Date('2026-11-15T10:00:00Z');
    const p = resolvePeriod({}, now);
    expect(p.range).toBe('30d');
    expect(p.to.toISOString()).toBe('2026-11-16T00:00:00.000Z');
    expect(p.from.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(p.cmpTo).toEqual(p.from);
    expect(p.to.getTime() - p.from.getTime()).toBe(p.cmpTo!.getTime() - p.cmpFrom!.getTime());
    expect(p.bucket).toBe('day');
    const lm = resolvePeriod({ range: 'last_month', compare: 'prev_year' }, now);
    expect([lm.from.toISOString(), lm.to.toISOString()]).toEqual([
      '2026-10-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
    ]);
    expect(lm.cmpFrom!.toISOString()).toBe('2025-10-01T00:00:00.000Z');
    expect(resolvePeriod({ range: 'this_year', compare: 'none' }, now)).toMatchObject({
      cmpFrom: null,
      bucket: 'month',
    });
    // A bad custom range falls back to the default instead of failing.
    expect(
      resolvePeriod({ range: 'custom', from: '2026-11-10', to: '2026-11-01' }, now).range,
    ).toBe('30d');
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(15, 10)).toBe(50);
  });

  it('returns aggregates only, statuses that sum to the cohort, and revenue only for finance roles', async () => {
    const founder = await makeUser('cc_founder');
    const analyst = await makeUser('cc_analyst');
    await owner_.db.execute(
      sql`insert into platform_admins (user_id, role) values (${founder}, 'founder'), (${analyst}, 'analyst')`,
    );
    const p = resolvePeriod({ range: 'this_year' });
    const c = await getCommandCenter(db, { userId: founder }, p);
    expect(c.kpi.users_total).toBeGreaterThan(0);
    expect(c.kpi.orgs_total).toBeGreaterThan(0);
    const s = c.doc_status;
    expect(s.completed + s.pending + s.declined + s.expired + s.cancelled + s.failed).toBe(s.total);
    expect(s.total).toBe(c.kpi.docs_sent);
    expect(c.doc_types.reduce((n, t) => n + t.count, 0)).toBeLessThanOrEqual(s.total);
    expect(c.revenue).not.toBeNull();
    expect(c.security.audit_append_only).toBe(true);
    expect(c.growth.length).toBeGreaterThan(0);
    const last = c.growth[c.growth.length - 1]!;
    expect(last.users_total).toBe(c.kpi.users_total);
    // No customer names, emails or document titles in the payload.
    const json = JSON.stringify(c);
    expect(json).not.toContain('@example.test');
    expect(json).not.toContain('Lease');
    const a = await getCommandCenter(db, { userId: analyst }, p);
    expect(a.revenue).toBeNull();
    expect(a.audit).toBeNull();
    await expect(getCommandCenter(db, { userId: owner }, p)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('platform performance', () => {
  it('checks the role on every tab and keeps each tab internally consistent', async () => {
    const founder = await makeUser('pp_founder');
    const analyst = await makeUser('pp_analyst');
    const technical = await makeUser('pp_tech');
    await owner_.db.execute(
      sql`insert into platform_admins (user_id, role) values (${founder}, 'founder'), (${analyst}, 'analyst'), (${technical}, 'technical')`,
    );
    const p = resolvePeriod({ range: 'this_year' });
    const f = { userId: founder };

    // Customers (even workspace owners) get nothing from any tab.
    for (const get of [
      getPerfGrowth,
      getPerfEngagement,
      getPerfFeatures,
      getPerfConversion,
      getPerfDelivery,
    ])
      await expect(get(db, { userId: owner }, p)).rejects.toMatchObject({ code: 'forbidden' });

    const g = await getPerfGrowth(db, f, p);
    const last = g.series[g.series.length - 1]!;
    expect(last.users_total).toBe(g.kpi.users_total);
    expect(last.orgs_total).toBe(g.kpi.orgs_total);
    // New per interval adds up to new in the period; cumulative differs from new.
    expect(g.series.reduce((n, s) => n + s.users_new, 0)).toBe(g.kpi.users_new);
    expect(g.series.reduce((n, s) => n + s.orgs_new, 0)).toBe(g.kpi.orgs_new);
    expect(g.kpi.users_start + g.kpi.users_new).toBe(g.kpi.users_total);
    expect(g.kpi.orgs_paid).toBeLessThanOrEqual(g.kpi.orgs_total);

    const e = await getPerfEngagement(db, f, p);
    const fr = e.frequency;
    // Every registered person is in exactly one activity group.
    expect(fr.daily + fr.several_weekly + fr.weekly + fr.occasional + fr.inactive).toBe(
      e.kpi.registered,
    );
    expect(e.kpi.wau).toBeLessThanOrEqual(e.kpi.mau);
    expect(e.kpi.feature_users).toBeLessThanOrEqual(e.kpi.active_users);

    const ft = await getPerfFeatures(db, f, p);
    expect(ft.rows.map((r) => r.feature).sort()).toEqual(
      ['api', 'contacts', 'create', 'integrations', 'send', 'studio', 'team', 'templates'].sort(),
    );
    // Adoption counts distinct people, so no feature has more users than eligible people.
    for (const r of ft.rows) {
      expect(r.users).toBeLessThanOrEqual(ft.eligible);
      expect(r.returning_users).toBeLessThanOrEqual(r.users);
      expect(r.events).toBeGreaterThanOrEqual(r.users);
    }
    expect(ft.rows.find((r) => r.feature === 'send')!.users).toBeGreaterThan(0);

    const cv = await getPerfConversion(db, f, p);
    expect(cv.funnel.document_sent).toBeLessThanOrEqual(cv.funnel.registered);
    expect(cv.funnel.repeat).toBeLessThanOrEqual(cv.funnel.document_sent);
    expect(cv.paid_funnel.repeat).toBeLessThanOrEqual(cv.paid_funnel.paid);
    // Retention only counts people who have passed the whole window.
    expect(cv.retention.d30_eligible).toBeLessThanOrEqual(cv.retention.d7_eligible);
    expect(cv.retention.d7_eligible).toBeLessThanOrEqual(cv.retention.d1_eligible);
    expect(cv.retention.d1).toBeLessThanOrEqual(cv.retention.d1_eligible);
    expect(cv.cohorts).toHaveLength(6);
    for (const row of cv.cohorts) if (row.size < 5) expect(row.retained).toBeNull();

    const d = await getPerfDelivery(db, f, p);
    const s = d.status;
    expect(s.completed + s.pending + s.declined + s.expired + s.cancelled + s.failed).toBe(s.total);
    expect(s.total).toBe(d.kpi.sent);
    expect(d.series.reduce((n, x) => n + x.sent, 0)).toBe(d.kpi.sent);
    expect(d.failures).not.toBeNull();

    // Sanitized and aggregate only: no emails, names or titles anywhere.
    const json = JSON.stringify([g, e, ft, cv, d]);
    expect(json).not.toContain('@example.test');
    expect(json).not.toContain('Lease');

    // The failure list is for technical, security and founder roles only.
    expect((await getPerfDelivery(db, { userId: analyst }, p)).failures).toBeNull();
    expect((await getPerfDelivery(db, { userId: technical }, p)).failures).not.toBeNull();
  });

  it('only calls out changes with a comparison, enough data and a real threshold', () => {
    const p = resolvePeriod({ range: '30d', compare: 'previous' });
    const base = {
      kpi: {
        users_total: 100,
        users_new: 30,
        users_new_cmp: 20,
        orgs_total: 40,
        orgs_new: 5,
        orgs_new_cmp: 5,
        orgs_active: 10,
        docs_sent: 40,
        docs_sent_cmp: 40,
        docs_sent_total: 200,
        docs_completed: 30,
        docs_completed_cmp: 25,
        cohort_completed: 30,
        cohort_completed_cmp: 20,
        designs_new: 4,
        designs_new_cmp: 4,
        studio_purchases: 1,
        studio_purchases_cmp: 1,
      },
      growth: [],
      doc_status: {
        completed: 0,
        pending: 0,
        declined: 0,
        expired: 0,
        cancelled: 0,
        failed: 0,
        total: 0,
      },
      doc_types: [],
      features: { active_users: 0, rows: [] },
      studio: { sessions: 3, sessions_cmp: 2, designs: 4, designs_purchased: 1, downloads: 0 },
      revenue: {
        totals: [
          {
            currency: 'USD',
            gross: 1200,
            refunded: 0,
            disputed: 0,
            net: 1200,
            gross_cmp: 1000,
            net_cmp: 1000,
          },
        ],
        by_kind: [],
        series: [],
      },
      activity: [],
      audit: null,
      security: {
        staff: 1,
        staff_strong: 1,
        denied: 0,
        audit_append_only: true,
        production_signing: false,
      },
      health: {
        finalization_failed: 0,
        webhooks_total: 0,
        webhooks_ok: 0,
        webhooks_dead: 0,
        emails_total: 0,
        emails_ok: 0,
        emails_bounced: 0,
        emails_failed: 0,
        stripe_unprocessed: 0,
        sync_failed: 0,
      },
      generated_at: new Date().toISOString(),
    } as CommandCenter;
    const ids = (c: CommandCenter, per = p) =>
      buildInsights(c, per, (t) => `/t/${t}`).map((i) => i.id);

    // +50% sign-ups, +25pp completion, +20% revenue.
    expect(ids(base)).toEqual(['growth_up', 'completion_up', 'revenue_up']);
    // Small samples produce no headline.
    expect(
      ids({
        ...base,
        kpi: { ...base.kpi, users_new: 6, users_new_cmp: 4, docs_sent: 5, docs_sent_cmp: 5 },
      }),
    ).toEqual(['revenue_up']);
    // No comparison period, no change claims.
    expect(ids(base, resolvePeriod({ range: '30d', compare: 'none' }))).toEqual([]);
    // A rise in failures is never good news, and problems come first.
    const bad = { ...base, health: { ...base.health, finalization_failed: 2, webhooks_dead: 1 } };
    expect(ids(bad).slice(0, 2)).toEqual(['finalization_failures', 'webhooks_dead']);
    expect(ids(bad).length).toBeLessThanOrEqual(5);
    // Revenue changes need a non-zero baseline; analysts (no revenue) get no revenue insight.
    expect(ids({ ...base, revenue: null })).not.toContain('revenue_up');

    expect(ppChange(30, 25)).toBe(5);
    expect(ppChange(null, 25)).toBeNull();
    expect(pctChange(5, 0)).toBeNull();
    expect(parsePerfTab('delivery')).toBe('delivery');
    expect(parsePerfTab('../etc')).toBe('overview');
  });

  it('exports aggregates with the period in the header', () => {
    const p = resolvePeriod({ range: '7d' });
    const rows = perfCsv(
      'engagement',
      {
        kpi: {
          active_users: 1,
          active_users_cmp: null,
          dau_avg: 1,
          wau: 1,
          mau: 1,
          active_days: 1,
          signins: 1,
          returning: null,
          registered: 2,
          orgs_active: 1,
          orgs_active_cmp: null,
          feature_users: 1,
          period_days: 7,
        },
        series: [{ start: p.from.toISOString(), active_users: 1, signins: 1, orgs_active: 1 }],
        frequency: { daily: 0, several_weekly: 0, weekly: 0, occasional: 1, inactive: 1 },
        by_plan: [],
        generated_at: 'now',
      },
      p,
    );
    expect(rows[0]![0]).toContain('Engagement');
    expect(rows[1]).toEqual(['Period (UTC)', p.from.toISOString(), p.to.toISOString()]);
  });
});

describe('privacy-first measurement', () => {
  it('classifies sources into coarse categories and keeps nothing else', () => {
    const c = (referrer: string | null, url = 'https://signaturetender.com/') =>
      classifySource({ referrer, url, ownHost: 'signaturetender.com' });
    expect(c(null)).toBe('direct');
    expect(c('https://signaturetender.com/pricing')).toBe('direct');
    expect(c('https://www.google.co.uk/search?q=secret+terms')).toBe('search');
    expect(c('https://duckduckgo.com/')).toBe('search');
    expect(c('https://chatgpt.com/')).toBe('ai_assistant');
    expect(c('https://www.linkedin.com/feed/')).toBe('social');
    expect(c('https://t.co/abc')).toBe('social');
    expect(c('https://mail.google.com/')).toBe('email');
    expect(c('https://someblog.example/post')).toBe('referral');
    expect(c(null, 'https://signaturetender.com/?utm_medium=cpc&utm_source=x')).toBe('campaign');
    expect(c(null, 'https://signaturetender.com/?gclid=abc')).toBe('campaign');
    expect(c(null, 'https://signaturetender.com/?utm_medium=email')).toBe('email');
    expect(c(null, 'https://signaturetender.com/?utm_source=partner')).toBe('campaign');
    expect(c('not a url')).toBe('direct');
    expect(pageGroup('/')).toBe('home');
    expect(pageGroup('/pricing')).toBe('pricing');
    expect(pageGroup('/sign-up')).toBe('sign_up');
    expect(pageGroup('/verify/abc123')).toBe('verify');
    expect(pageGroup('/something/else')).toBe('other');
    expect(minutesPerDay(600, 2)).toBe(5);
    expect(minutesPerDay(null, 2)).toBeNull();
    expect(minutesPerDay(100, 0)).toBeNull();
  });

  it('records visits, sources, active time and renewals, and reports them only to staff', async () => {
    const founder = await makeUser('ms_founder');
    const analyst = await makeUser('ms_analyst');
    await owner_.db.execute(
      sql`insert into platform_admins (user_id, role) values (${founder}, 'founder'), (${analyst}, 'analyst')`,
    );
    const p = resolvePeriod({ range: 'this_year' });
    const before = await getPerfMeasurement(db, { userId: founder }, p);

    // The app role can't read the raw tables back.
    for (const t of [
      'site_visits_daily',
      'user_acquisition',
      'app_activity_daily',
      'subscription_events',
    ])
      await expect(db.execute(sql.raw(`select * from ${t} limit 1`))).rejects.toThrow();

    // Visits: unknown values fold into safe defaults.
    await recordVisit(db, 'pricing', 'search');
    await recordVisit(db, 'pricing', 'search');
    await recordVisit(db, '/app/documents/secret', 'direct');
    await expect(
      db.execute(sql`select st_track_visit('home', 'https://evil.example/?email=a@b.c')`),
    ).resolves.toBeDefined();

    // Sign-up source: once per account, only for recent accounts.
    const fresh = await makeUser('ms_fresh');
    await recordSignupSource(db, { userId: fresh }, 'social');
    await recordSignupSource(db, { userId: fresh }, 'search');
    const old = await makeUser('ms_old');
    await owner_.db.execute(
      sql`update "user" set created_at = now() - interval '30 days' where id = ${old}`,
    );
    await recordSignupSource(db, { userId: old }, 'search');
    const acq = (await owner_.db.execute(
      sql`select user_id, source from user_acquisition where user_id in (${fresh}, ${old})`,
    )) as unknown as { user_id: string; source: string }[];
    expect(acq).toEqual([{ user_id: fresh, source: 'social' }]);

    // Active time: capped per report and by the time that has actually passed.
    await recordActiveTime(db, { userId: fresh }, 600);
    await recordActiveTime(db, { userId: fresh }, 60);
    const [act] = (await owner_.db.execute(
      sql`select active_seconds from app_activity_daily where user_id = ${fresh}`,
    )) as unknown as { active_seconds: number }[];
    expect(act!.active_seconds).toBeGreaterThanOrEqual(90);
    expect(act!.active_seconds).toBeLessThanOrEqual(90 + 6);

    // Time in app is withheld until at least 5 people are tracked.
    const m1 = await getPerfMeasurement(db, { userId: founder }, p);
    expect(m1.visits.total - before.visits.total).toBe(4);
    const pricing = m1.visits.by_page.find((r) => r.page === 'pricing');
    expect(pricing?.visits).toBeGreaterThanOrEqual(2);
    expect(m1.visits.by_page.some((r) => r.page.includes('/'))).toBe(false);
    expect(m1.visits.series.reduce((n, s) => n + s.visits, 0)).toBe(m1.visits.total);
    expect(m1.signups.recorded).toBeGreaterThanOrEqual(1);
    // One social sign-up is below the group minimum, so it shows as Other.
    if (m1.signups.by_source.find((r) => r.source === 'social'))
      expect(m1.signups.by_source.find((r) => r.source === 'social')!.users).toBeGreaterThanOrEqual(
        5,
      );
    const t0 = m1.time;
    if (t0.suppressed) {
      const more = await Promise.all([1, 2, 3, 4, 5].map((i) => makeUser(`ms_t${i}`)));
      for (const u of more) await recordActiveTime(db, { userId: u }, 45);
    }
    const m2 = await getPerfMeasurement(db, { userId: analyst }, p);
    expect(m2.time.suppressed).toBe(false);
    if (!m2.time.suppressed) {
      const b = m2.time.bands;
      expect(b.under_5m + b.m5_30 + b.m30_2h + b.over_2h).toBe(m2.time.users);
      expect(m2.time.user_days).toBeGreaterThanOrEqual(m2.time.users);
    }

    // Renewals and lifecycle from Stripe facts, each recorded once.
    const ws7 = (await createWorkspace(db, { userId: owner }, { name: 'Renewals WS' })).id;
    const cus = `cus_ms${Date.now()}`;
    await linkStripeCustomer(db, { userId: owner }, ws7, cus);
    const sub = `sub_ms${Date.now()}`;
    const end = new Date(Date.now() + 30 * 86_400_000);
    const subFacts = {
      subscriptionId: sub,
      customerId: cus,
      status: 'active',
      planCode: 'starter',
      workspaceId: ws7,
      currentPeriodStart: new Date(),
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      deleted: false,
    };
    await applySubscription(db, subFacts);
    const inv = {
      customerId: cus,
      number: null,
      description: null,
      amountDue: 999,
      amountPaid: 0,
      currency: 'usd',
      hostedUrl: null,
      pdfUrl: null,
      createdAt: new Date(),
      subscriptionId: sub,
      planCode: 'starter',
      periodStart: new Date(),
      periodEnd: end,
    };
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_c_${sub}`,
      status: 'paid',
      amountPaid: 999,
      billingReason: 'subscription_create',
    });
    // A renewal that fails first and is paid on retry; a second that is still unpaid.
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_r1_${sub}`,
      status: 'open',
      attempted: true,
      billingReason: 'subscription_cycle',
    });
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_r1_${sub}`,
      status: 'paid',
      amountPaid: 999,
      billingReason: 'subscription_cycle',
    });
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_r1_${sub}`,
      status: 'paid',
      amountPaid: 999,
      billingReason: 'subscription_cycle',
    });
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_r2_${sub}`,
      status: 'open',
      billingReason: 'subscription_cycle',
    });
    await applyInvoice(db, {
      ...inv,
      invoiceId: `in_r2_${sub}`,
      status: 'open',
      attempted: true,
      billingReason: 'subscription_cycle',
    });
    await applySubscription(db, { ...subFacts, cancelAtPeriodEnd: true });
    await applySubscription(db, { ...subFacts, cancelAtPeriodEnd: true });
    await applySubscription(db, { ...subFacts, cancelAtPeriodEnd: false });
    await applySubscription(db, { ...subFacts, status: 'canceled', deleted: true });
    await applySubscription(db, { ...subFacts, status: 'canceled', deleted: true });
    const ev = (await owner_.db.execute(
      sql`select kind, count(*)::int as n from subscription_events where workspace_id = ${ws7} group by kind order by kind`,
    )) as unknown as { kind: string; n: number }[];
    expect(Object.fromEntries(ev.map((e) => [e.kind, e.n]))).toEqual({
      cancel_requested: 1,
      cancel_withdrawn: 1,
      ended: 1,
      renewal_failed: 2,
      renewed: 1,
      started: 1,
    });
    expect(
      invoiceLifecycleKind({
        ...inv,
        invoiceId: 'x',
        status: 'open',
        billingReason: 'subscription_cycle',
      }),
    ).toBeNull();
    expect(
      invoiceLifecycleKind({
        ...inv,
        invoiceId: 'x',
        status: 'paid',
        billingReason: 'manual',
        subscriptionId: null,
      }),
    ).toBeNull();

    const m3 = await getPerfMeasurement(db, { userId: founder }, p);
    const r = m3.renewals;
    expect(r.due - m1.renewals.due).toBe(2);
    expect(r.renewed - m1.renewals.renewed).toBe(1);
    expect(r.failed - m1.renewals.failed).toBe(2);
    expect(r.recovered - m1.renewals.recovered).toBe(1);
    expect(r.ended - m1.renewals.ended).toBe(1);
    expect(r.series.reduce((n, s) => n + s.started, 0)).toBe(r.started);

    // Customers get nothing; exports carry the measurement sections.
    await expect(getPerfMeasurement(db, { userId: owner }, p)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(measurementCsv('growth', m3).flat()).toContain('Visits by source');
    expect(measurementCsv('conversion', m3).flat()).toContain('Renewals due');
    expect(measurementCsv('engagement', m3).flat().join(' ')).toContain('Active seconds');
    expect(await pruneMeasurement(db)).toBeGreaterThanOrEqual(0);
  });
});
