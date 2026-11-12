import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { lookup as lookupCb, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema, withActor, type Database, type ActorContext, type Tx } from '@st/db';
import { AppError } from './errors';
import { recordAudit } from './audit';
import { newSecret } from './signing-crypto';

type Meta = { ipAddress?: string | null; userAgent?: string | null };
const uuid = z.string().uuid();

/** Events a webhook can subscribe to (spec Part 23). Payloads carry references, never PDFs. */
export const WEBHOOK_EVENTS = [
  'request.created',
  'request.sent',
  'request.completed',
  'request.declined',
  'request.expired',
  'request.cancelled',
  'recipient.viewed',
  'recipient.authenticated',
  'recipient.signed',
  'recipient.approved',
  'recipient.declined',
  'document.finalized',
  'document.available',
  'payment.succeeded',
  'payment.failed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

// ---------------------------------------------------------------------------------------------
// Secret encryption. Endpoint secrets must be readable to sign payloads, so they are encrypted
// at rest with AES-256-GCM under a key derived from a server secret that never reaches the DB.

/** Derives the 32-byte encryption key from a server secret (at least 32 characters). */
export function deriveSecretsKey(serverSecret: string): Buffer {
  if (!serverSecret || serverSecret.length < 32)
    throw new Error('The secrets encryption key must be at least 32 characters');
  return Buffer.from(
    hkdfSync('sha256', serverSecret, 'signature-tender', 'webhook-secrets-v1', 32),
  );
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    c.getAuthTag().toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

export function decryptSecret(sealed: string, key: Buffer): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------------------------
// Destination checks (SSRF). Webhooks only go to public HTTPS addresses.

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
  ['2001:db8::', 32],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  const fam = isIP(ip);
  if (fam === 4) return blocked.check(ip, 'ipv4');
  if (fam === 6) return blocked.check(ip, 'ipv6');
  return true;
}

export type HostResolver = (host: string) => Promise<string[]>;
const defaultResolver: HostResolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export interface UrlPolicy {
  /** Lets http://localhost through, for local development only. Never set in production. */
  allowLocalhost?: boolean;
  resolve?: HostResolver;
}

/** Throws unless the URL is HTTPS and every address it resolves to is public. */
export async function validateWebhookUrl(raw: string, policy: UrlPolicy = {}): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError('invalid', 'Enter a full URL starting with https://');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (policy.allowLocalhost && local && (u.protocol === 'http:' || u.protocol === 'https:'))
    return u;
  if (u.protocol !== 'https:') throw new AppError('invalid', 'Webhook URLs must use https://');
  if (u.username || u.password)
    throw new AppError('invalid', 'Webhook URLs cannot contain credentials.');
  if (u.port && u.port !== '443')
    throw new AppError('invalid', 'Webhook URLs must use the standard HTTPS port.');
  if (raw.length > 2000) throw new AppError('invalid', 'That URL is too long.');
  let addrs: string[];
  try {
    addrs = isIP(host) ? [host] : await (policy.resolve ?? defaultResolver)(host);
  } catch {
    throw new AppError('invalid', 'That host name could not be found.');
  }
  if (!addrs.length || addrs.some(isPrivateAddress))
    throw new AppError('invalid', 'Webhook URLs must point to a public internet address.');
  return u;
}

/**
 * Sends one webhook POST and returns the HTTP status. The address is checked again at connect
 * time, inside the socket's own DNS lookup, so a host that resolves to a public address during
 * validation and to a private one a moment later (DNS rebinding) is refused. Redirects are never
 * followed and the response body is discarded.
 */
export function pinnedPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  opts: { timeoutMs: number; allowLocalhost?: boolean },
): Promise<number> {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const allowPrivate = Boolean(opts.allowLocalhost && local);
  if (u.protocol !== 'https:' && !allowPrivate)
    return Promise.reject(new Error('Webhook URLs must use https://'));
  if (isIP(host) && isPrivateAddress(host) && !allowPrivate)
    return Promise.reject(new Error('Destination is not a public internet address'));
  const checkedLookup = (
    hostname: string,
    options: object,
    cb: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    lookupCb(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err, []);
      const list = addrs as LookupAddress[];
      if (!list.length || (!allowPrivate && list.some((a) => isPrivateAddress(a.address))))
        return cb(
          Object.assign(new Error('Destination is not a public internet address'), {
            code: 'EPRIVATE',
          }),
          [],
        );
      if ((options as { all?: boolean }).all) return cb(null, list);
      cb(null, list[0]!.address, list[0]!.family);
    });
  };
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      u,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        lookup: checkedLookup as never,
        timeout: opts.timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

/** Slack incoming webhook URLs only (https://hooks.slack.com/services/...). */
export function validateSlackWebhookUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new AppError('invalid', 'Paste the full Slack webhook URL.');
  }
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'hooks.slack.com' ||
    (u.port && u.port !== '443') ||
    u.username ||
    u.password ||
    !/^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(u.pathname)
  )
    throw new AppError(
      'invalid',
      'That is not a Slack incoming webhook URL. It should start with https://hooks.slack.com/services/',
    );
  return u;
}

/** A Slack webhook URL works as a password; only its host is shown after it is saved. */
export function maskSlackUrl(url: string) {
  return url.startsWith('https://hooks.slack.com/') ? 'https://hooks.slack.com/services/••••' : url;
}

/** Events a Slack connection posts by default. */
export const SLACK_DEFAULT_EVENTS: WebhookEventType[] = [
  'request.sent',
  'recipient.signed',
  'request.completed',
  'request.declined',
  'request.expired',
  'request.cancelled',
  'payment.failed',
];

const SLACK_LABELS: Record<string, string> = {
  'request.created': 'was created',
  'request.sent': 'was sent for signature',
  'request.completed': 'is complete. Everyone has signed',
  'request.declined': 'was declined',
  'request.expired': 'expired before everyone signed',
  'request.cancelled': 'was cancelled',
  'recipient.viewed': 'was opened by a recipient',
  'recipient.authenticated': 'had a recipient verify their email',
  'recipient.signed': 'was signed by a recipient',
  'recipient.approved': 'was approved',
  'recipient.declined': 'was declined by a recipient',
  'document.finalized': 'has its signed copy and certificate ready',
  'document.available': 'is ready to download',
};

const slackEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain-text Slack message: title, what happened and a link into the app. No emails or contents. */
export function slackMessage(
  type: string,
  data: Record<string, unknown>,
  appUrl: string,
): { text: string } {
  const test = data.test ? '[TEST] ' : '';
  if (type === 'webhook.test')
    return {
      text: 'Signature Tender is connected. Notifications for this workspace will appear here.',
    };
  if (type.startsWith('payment.')) {
    const amount =
      typeof data.amount_cents === 'number'
        ? ` (${(data.amount_cents / 100).toFixed(2)} ${String(data.currency ?? '').toUpperCase()})`
        : '';
    return {
      text: `${type === 'payment.succeeded' ? 'Payment received' : 'A payment failed'}${amount}. <${appUrl}/app/billing|Open Billing & Credits>`,
    };
  }
  const title = slackEscape(String(data.title ?? 'A document'));
  const link = data.document_id
    ? ` <${appUrl}/app/documents/${String(data.document_id)}|Open in Signature Tender>`
    : '';
  return { text: `${test}*${title}* ${SLACK_LABELS[type] ?? `had an update (${type})`}.${link}` };
}

// ---------------------------------------------------------------------------------------------
// Signatures. Header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, with a second v1
// during a secret rotation. Receivers reject timestamps older than five minutes (replay).

export const SIGNATURE_HEADER = 'Signature-Tender-Signature';
export const EVENT_ID_HEADER = 'Signature-Tender-Event-Id';

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function buildSignatureHeader(secrets: string[], timestamp: number, body: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${signPayload(s, timestamp, body)}`)].join(
    ',',
  );
}

/** For receivers (and our own tests): checks the signature and the timestamp window. */
export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  body: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isInteger(t)) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) return false;
  const expected = Buffer.from(signPayload(secret, t, body), 'hex');
  return parts
    .filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? ''))
    .some(([, v]) => timingSafeEqual(Buffer.from(v, 'hex'), expected));
}

// ---------------------------------------------------------------------------------------------
// Endpoint management (members with api.manage).

export const webhookInputSchema = z.object({
  url: z.string().trim().min(1, 'Enter the URL').max(2000),
  description: z.string().trim().max(200).optional().default(''),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length).optional().default([]),
});

async function requireApiManage(tx: Tx, ws: string) {
  const [r] = (await tx.execute(
    sql`select st_has_permission(${ws}::uuid, 'api.manage') as ok`,
  )) as unknown as { ok: boolean }[];
  if (!r?.ok) throw new AppError('forbidden', 'Your role does not allow managing webhooks.');
}

export interface WebhookContext {
  encKey: Buffer;
  urlPolicy?: UrlPolicy;
}

const whsec = () => `whsec_${newSecret()}`;

/** Creates an endpoint. The signing secret is returned once. */
export async function createWebhookEndpoint(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  raw: z.input<typeof webhookInputSchema>,
  ctx: WebhookContext,
  meta: Meta = {},
): Promise<{ id: string; secret: string }> {
  if (!uuid.safeParse(workspaceId).success) throw new AppError('not_found', 'Workspace not found');
  const input = webhookInputSchema.parse(raw);
  const url = (await validateWebhookUrl(input.url, ctx.urlPolicy)).toString();
  const secret = whsec();
  const id = await withActor(db, actor, async (tx) => {
    await requireApiManage(tx, workspaceId);
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.workspaceId, workspaceId));
    if ((n?.n ?? 0) >= 20)
      throw new AppError('conflict', 'A workspace can have up to 20 webhook endpoints.');
    const [row] = await tx
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId,
        url,
        description: input.description,
        events: [...new Set(input.events)],
        secretEncrypted: encryptSecret(secret, ctx.encKey),
        createdBy: actor.userId,
      })
      .returning({ id: schema.webhookEndpoints.id });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'webhook.endpoint_created',
      targetType: 'webhook_endpoint',
      targetId: row!.id,
      metadata: { url, events: input.events },
      ...meta,
    });
    return row!.id;
  });
  return { id, secret };
}

/** Slack endpoint for the Slack integration. Slack messages are not signed, so no secret is shown. */
export async function createSlackEndpoint(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  url: string,
  ctx: WebhookContext,
  meta: Meta = {},
): Promise<{ id: string }> {
  const valid = validateSlackWebhookUrl(url).toString();
  return withActor(db, actor, async (tx) => {
    await requireApiManage(tx, workspaceId);
    const [row] = await tx
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId,
        url: valid,
        format: 'slack',
        description: 'Slack notifications',
        events: SLACK_DEFAULT_EVENTS,
        secretEncrypted: encryptSecret(whsec(), ctx.encKey),
        createdBy: actor.userId,
      })
      .returning({ id: schema.webhookEndpoints.id });
    await recordAudit(tx, {
      workspaceId,
      actorUserId: actor.userId,
      action: 'webhook.endpoint_created',
      targetType: 'webhook_endpoint',
      targetId: row!.id,
      metadata: { format: 'slack' },
      ...meta,
    });
    return { id: row!.id };
  });
}

export async function listWebhookEndpoints(db: Database, actor: ActorContext, workspaceId: string) {
  return withActor(db, actor, async (tx) => {
    await requireApiManage(tx, workspaceId);
    const rows = await tx
      .select({
        id: schema.webhookEndpoints.id,
        url: schema.webhookEndpoints.url,
        format: schema.webhookEndpoints.format,
        description: schema.webhookEndpoints.description,
        events: schema.webhookEndpoints.events,
        enabled: schema.webhookEndpoints.enabled,
        disabledReason: schema.webhookEndpoints.disabledReason,
        previousSecretExpiresAt: schema.webhookEndpoints.previousSecretExpiresAt,
        createdAt: schema.webhookEndpoints.createdAt,
      })
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.workspaceId, workspaceId))
      .orderBy(desc(schema.webhookEndpoints.createdAt));
    return rows.map((r) => (r.format === 'slack' ? { ...r, url: maskSlackUrl(r.url) } : r));
  });
}

async function loadEndpoint(tx: Tx, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError('not_found', 'Webhook not found');
  const [e] = await tx
    .select()
    .from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.id, id));
  if (!e) throw new AppError('not_found', 'Webhook not found');
  return e;
}

export async function setWebhookEnabled(
  db: Database,
  actor: ActorContext,
  endpointId: string,
  enabled: boolean,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const e = await loadEndpoint(tx, endpointId);
    await tx
      .update(schema.webhookEndpoints)
      .set({
        enabled,
        disabledReason: enabled ? null : 'Paused by a member',
        updatedAt: new Date(),
      })
      .where(eq(schema.webhookEndpoints.id, endpointId));
    await recordAudit(tx, {
      workspaceId: e.workspaceId,
      actorUserId: actor.userId,
      action: enabled ? 'webhook.endpoint_enabled' : 'webhook.endpoint_paused',
      targetType: 'webhook_endpoint',
      targetId: endpointId,
      ...meta,
    });
  });
}

/** New secret now; the previous one keeps signing alongside it for 24 hours. */
export async function rotateWebhookSecret(
  db: Database,
  actor: ActorContext,
  endpointId: string,
  ctx: WebhookContext,
  meta: Meta = {},
): Promise<{ secret: string }> {
  const secret = whsec();
  await withActor(db, actor, async (tx) => {
    const e = await loadEndpoint(tx, endpointId);
    await tx
      .update(schema.webhookEndpoints)
      .set({
        secretEncrypted: encryptSecret(secret, ctx.encKey),
        previousSecretEncrypted: e.secretEncrypted,
        previousSecretExpiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date(),
      })
      .where(eq(schema.webhookEndpoints.id, endpointId));
    await recordAudit(tx, {
      workspaceId: e.workspaceId,
      actorUserId: actor.userId,
      action: 'webhook.secret_rotated',
      targetType: 'webhook_endpoint',
      targetId: endpointId,
      ...meta,
    });
  });
  return { secret };
}

export async function deleteWebhookEndpoint(
  db: Database,
  actor: ActorContext,
  endpointId: string,
  meta: Meta = {},
) {
  await withActor(db, actor, async (tx) => {
    const e = await loadEndpoint(tx, endpointId);
    await tx.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, endpointId));
    await recordAudit(tx, {
      workspaceId: e.workspaceId,
      actorUserId: actor.userId,
      action: 'webhook.endpoint_deleted',
      targetType: 'webhook_endpoint',
      targetId: endpointId,
      metadata: { url: e.url },
      ...meta,
    });
  });
}

/** Queues a `webhook.test` event to one endpoint. */
export async function sendTestWebhook(db: Database, actor: ActorContext, endpointId: string) {
  if (!uuid.safeParse(endpointId).success) throw new AppError('not_found', 'Webhook not found');
  const [r] = (await withActor(db, actor, (tx) =>
    tx.execute(sql`select st_webhook_test(${endpointId}::uuid) as id`),
  )) as unknown as { id: string | null }[];
  if (!r?.id) throw new AppError('not_found', 'Webhook not found');
  return r.id;
}

export async function retryWebhookDelivery(db: Database, actor: ActorContext, deliveryId: string) {
  if (!uuid.safeParse(deliveryId).success) throw new AppError('not_found', 'Delivery not found');
  const [r] = (await withActor(db, actor, (tx) =>
    tx.execute(sql`select st_webhook_retry(${deliveryId}::uuid) as ok`),
  )) as unknown as { ok: boolean }[];
  if (!r?.ok) throw new AppError('not_found', 'Delivery not found');
}

/** Recent deliveries, newest first. Shows event type and outcome, never payload secrets. */
export async function listWebhookDeliveries(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  opts: {
    endpointId?: string;
    status?: 'failed' | 'dead' | 'succeeded' | 'pending';
    limit?: number;
  } = {},
) {
  return withActor(db, actor, async (tx) => {
    await requireApiManage(tx, workspaceId);
    const conds = [eq(schema.webhookDeliveries.workspaceId, workspaceId)];
    if (opts.endpointId && uuid.safeParse(opts.endpointId).success)
      conds.push(eq(schema.webhookDeliveries.endpointId, opts.endpointId));
    if (opts.status) conds.push(eq(schema.webhookDeliveries.status, opts.status));
    const rows = await tx
      .select({
        id: schema.webhookDeliveries.id,
        endpointId: schema.webhookDeliveries.endpointId,
        url: schema.webhookEndpoints.url,
        eventId: schema.webhookEvents.id,
        eventType: schema.webhookEvents.type,
        status: schema.webhookDeliveries.status,
        attempts: schema.webhookDeliveries.attempts,
        lastStatusCode: schema.webhookDeliveries.lastStatusCode,
        lastError: schema.webhookDeliveries.lastError,
        lastAttemptAt: schema.webhookDeliveries.lastAttemptAt,
        nextAttemptAt: schema.webhookDeliveries.nextAttemptAt,
        createdAt: schema.webhookDeliveries.createdAt,
      })
      .from(schema.webhookDeliveries)
      .innerJoin(
        schema.webhookEndpoints,
        eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId),
      )
      .innerJoin(
        schema.webhookEvents,
        eq(schema.webhookEvents.id, schema.webhookDeliveries.eventId),
      )
      .where(and(...conds))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    return rows.map((r) => ({ ...r, url: maskSlackUrl(r.url) }));
  });
}

// ---------------------------------------------------------------------------------------------
// Dispatcher. Runs from a cron route with no signed-in member; it can only move outbox rows.

export interface DispatchOptions extends WebhookContext {
  /** Base URL for links in Slack messages. */
  appUrl?: string;
  fetch?: typeof fetch;
  maxAttempts?: number;
  limit?: number;
  timeoutMs?: number;
}

export interface DispatchResult {
  fannedOut: number;
  attempted: number;
  succeeded: number;
  failed: number;
}

/** Turns new events into deliveries and sends what is due. Safe to run concurrently. */
export async function dispatchWebhooks(
  db: Database,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const limit = opts.limit ?? 50;
  const maxAttempts = opts.maxAttempts ?? 8;
  const [f] = (await db.transaction((tx) =>
    tx.execute(sql`select st_webhook_fanout(${limit * 4}) as n`),
  )) as unknown as { n: number }[];
  const due = (await db.transaction((tx) =>
    tx.execute(sql`select * from st_webhook_claim(${limit})`),
  )) as unknown as {
    delivery_id: string;
    endpoint_id: string;
    url: string;
    format: string;
    secret_encrypted: string;
    previous_secret_encrypted: string | null;
    previous_secret_expires_at: Date | string | null;
    event_id: string;
    event_type: string;
    event_data: Record<string, unknown>;
    event_created_at: Date | string;
    attempts: number;
    workspace_id: string;
  }[];
  const result: DispatchResult = {
    fannedOut: f?.n ?? 0,
    attempted: due.length,
    succeeded: 0,
    failed: 0,
  };

  type Due = (typeof due)[number];
  const post = async (d: Due, headers: Record<string, string>, body: string) => {
    const all = {
      'content-type': 'application/json',
      'user-agent': 'SignatureTender-Webhooks/1',
      ...headers,
    };
    const timeoutMs = opts.timeoutMs ?? 10_000;
    if (!opts.fetch)
      return pinnedPost(d.url, all, body, {
        timeoutMs,
        allowLocalhost: opts.urlPolicy?.allowLocalhost,
      });
    // Injected fetch (tests).
    const res = await opts.fetch(d.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: all,
      body,
    });
    await res.body?.cancel().catch(() => {});
    return res.status;
  };

  const deliver = async (
    d: Due,
  ): Promise<{ ok: boolean; status: number | null; error: string | null }> => {
    if (d.format === 'slack') {
      validateSlackWebhookUrl(d.url);
      const status = await post(
        d,
        {},
        JSON.stringify(slackMessage(d.event_type, d.event_data, opts.appUrl ?? '')),
      );
      const ok = status >= 200 && status < 300;
      return {
        ok,
        status,
        error: ok
          ? null
          : status === 404 || status === 410
            ? 'Slack says this webhook no longer exists'
            : `HTTP ${status}`,
      };
    }
    await validateWebhookUrl(d.url, opts.urlPolicy);
    const secrets = [decryptSecret(d.secret_encrypted, opts.encKey)];
    if (
      d.previous_secret_encrypted &&
      d.previous_secret_expires_at &&
      new Date(d.previous_secret_expires_at) > new Date()
    )
      secrets.push(decryptSecret(d.previous_secret_encrypted, opts.encKey));
    const body = JSON.stringify({
      id: d.event_id,
      type: d.event_type,
      created_at: new Date(d.event_created_at).toISOString(),
      workspace_id: d.workspace_id,
      data: d.event_data,
    });
    const t = Math.floor(Date.now() / 1000);
    const status = await post(
      d,
      {
        [EVENT_ID_HEADER]: d.event_id,
        'Signature-Tender-Delivery-Id': d.delivery_id,
        'Signature-Tender-Attempt': String(d.attempts + 1),
        [SIGNATURE_HEADER]: buildSignatureHeader(secrets, t, body),
      },
      body,
    );
    const ok = status >= 200 && status < 300;
    return {
      ok,
      status,
      error: ok
        ? null
        : status >= 300 && status < 400
          ? 'Redirects are not followed'
          : `HTTP ${status}`,
    };
  };

  await Promise.all(
    due.map(async (d) => {
      let r: { ok: boolean; status: number | null; error: string | null };
      try {
        r = await deliver(d);
      } catch (err) {
        r = {
          ok: false,
          status: null,
          error:
            err instanceof AppError
              ? err.message
              : err instanceof Error && err.name === 'TimeoutError'
                ? 'Timed out after 10 seconds'
                : 'Could not connect',
        };
      }
      await db.transaction((tx) =>
        tx.execute(
          sql`select st_webhook_record(${d.delivery_id}::uuid, ${r.ok}, ${r.status}, ${r.error}, ${maxAttempts})`,
        ),
      );
      if (r.ok) result.succeeded++;
      else result.failed++;
    }),
  );
  return result;
}
