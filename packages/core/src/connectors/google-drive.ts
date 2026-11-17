import { and, desc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { schema, withActor, type ActorContext, type Database } from '@st/db';
import { AppError } from '../errors';
import { createDocumentFromUpload } from '../documents';
import { setExternalRef } from '../api';
import { buildCompletionPackage } from '../certificate-pdf';
import type { ObjectStorage } from '../storage';
import { registerConnectorRuntime } from './registry';
import { connectionCaller, getAccessToken, type IntegrationContext } from './connections';
import { linkExternalRecord } from './mappings';
import { logActivity, sanitizeText } from './activity';
import { createAutomation, setAutomationEnabled } from './automations';
import { IntegrationError, type ActionContext, type ActionResult } from './types';

/**
 * Google Drive connector, built on the shared framework (OAuth, tokens, jobs, mappings, activity).
 * Uses the `drive.file` scope: Signature Tender sees only files the member picks in the Google
 * Picker and files it creates itself, never the rest of the Drive.
 */

type Call = ActionContext['call'];
type Meta = { ipAddress?: string | null; userAgent?: string | null };

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_SAVE_ACTION = 'drive.save_completed';
const SAVE_EVENT = 'document.available';

/** Google editor files are exported to PDF; anything else must already be a PDF. */
const EXPORTABLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

export function isDriveImportable(mime: string) {
  return mime === 'application/pdf' || EXPORTABLE.has(mime);
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  trashed?: boolean;
}

/** Connection settings for Drive. Stored on the connection; no secrets. */
export interface DriveSettings {
  autoSave: boolean;
  saveCertificate: boolean;
  saveCombined: boolean;
  folderId: string | null;
  folderName: string | null;
  naming: 'title' | 'title_date';
}

const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export function readDriveSettings(raw: Record<string, unknown> | null | undefined): DriveSettings {
  const r = raw ?? {};
  const folderId = typeof r.folderId === 'string' && FILE_ID.test(r.folderId) ? r.folderId : null;
  return {
    autoSave: r.autoSave === true,
    saveCertificate: r.saveCertificate !== false,
    saveCombined: r.saveCombined === true,
    folderId,
    folderName: folderId && typeof r.folderName === 'string' ? r.folderName.slice(0, 200) : null,
    naming: r.naming === 'title_date' || r.namingDate === true ? 'title_date' : 'title',
  };
}

async function failFor(res: Response, what: string): Promise<IntegrationError> {
  let reason = '';
  try {
    const j = (await res.json()) as { error?: { errors?: { reason?: string }[] } };
    reason = j.error?.errors?.[0]?.reason ?? '';
  } catch {
    /* not JSON */
  }
  if (res.status === 404)
    return new IntegrationError(
      'not_found',
      `${what} was not found in Google Drive, or Signature Tender cannot see it.`,
      { retryable: false },
    );
  if (reason === 'cannotExportFile' || reason === 'exportSizeLimitExceeded')
    return new IntegrationError('invalid_record', `${what} cannot be converted to PDF by Google.`, {
      retryable: false,
    });
  return new IntegrationError(
    'invalid_request',
    `${what}: Google Drive returned HTTP ${res.status}.`,
    { retryable: false },
  );
}

export async function getDriveFile(call: Call, fileId: string): Promise<DriveFile> {
  if (!FILE_ID.test(fileId))
    throw new IntegrationError('invalid_request', 'That is not a Google Drive file.', {
      retryable: false,
    });
  const res = await call(
    `${DRIVE}/files/${fileId}?fields=id,name,mimeType,size,trashed&supportsAllDrives=true`,
  );
  if (!res.ok) throw await failFor(res, 'The file');
  const f = (await res.json()) as DriveFile;
  if (f.trashed)
    throw new IntegrationError('not_found', 'That file is in the Google Drive trash.', {
      retryable: false,
    });
  return f;
}

/**
 * Downloads a picked file as PDF bytes. PDFs come as they are; Google Docs, Sheets and Slides are
 * exported to PDF, so what gets signed is a fixed representation that cannot change afterwards.
 */
export async function downloadDriveFileAsPdf(call: Call, file: DriveFile, maxBytes: number) {
  if (!isDriveImportable(file.mimeType))
    throw new IntegrationError(
      'invalid_record',
      'Only PDFs and Google Docs, Sheets and Slides can be imported. Save other files as PDF in Drive first.',
      { retryable: false },
    );
  const tooBig = () =>
    new IntegrationError('invalid_record', 'That file is larger than the upload limit.', {
      retryable: false,
    });
  if (file.size && Number(file.size) > maxBytes) throw tooBig();
  const exported = file.mimeType !== 'application/pdf';
  const res = await call(
    exported
      ? `${DRIVE}/files/${file.id}/export?mimeType=application%2Fpdf`
      : `${DRIVE}/files/${file.id}?alt=media&supportsAllDrives=true`,
  );
  if (!res.ok) throw await failFor(res, file.name);
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw tooBig();
  return { bytes, filename: `${file.name.replace(/\.pdf$/i, '')}.pdf`, exported };
}

const lit = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function findFiles(call: Call, q: string) {
  const u = new URL(`${DRIVE}/files`);
  u.search = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType)',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  }).toString();
  const res = await call(u.toString());
  if (!res.ok) throw await failFor(res, 'The folder');
  return ((await res.json()) as { files: DriveFile[] }).files;
}

/**
 * Where signed copies go: the folder the member picked, or a "Signature Tender" folder the app
 * creates once (and can find again, since apps see their own files under drive.file).
 */
export async function resolveDriveFolder(call: Call, folderId: string | null) {
  if (folderId) {
    const f = await getDriveFile(call, folderId);
    if (f.mimeType !== DRIVE_FOLDER_MIME)
      throw new IntegrationError('invalid_record', 'The chosen save location is not a folder.', {
        retryable: false,
      });
    return { id: f.id, name: f.name };
  }
  const found = await findFiles(
    call,
    `mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false and appProperties has { key='stFolder' and value='default' }`,
  );
  if (found[0]) return { id: found[0].id, name: found[0].name };
  const res = await call(`${DRIVE}/files?fields=id,name&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Signature Tender',
      mimeType: DRIVE_FOLDER_MIME,
      appProperties: { stFolder: 'default' },
    }),
  });
  if (!res.ok) throw await failFor(res, 'The Signature Tender folder');
  return (await res.json()) as { id: string; name: string };
}

/**
 * Uploads a PDF into a folder. The dedupe key is stored as an app property, so a retry after a
 * lost response finds the file it already uploaded instead of adding a second copy.
 */
export async function uploadPdfToDrive(
  call: Call,
  input: { folderId: string; name: string; bytes: Uint8Array; dedupeKey: string },
): Promise<{ id: string; name: string; reused: boolean }> {
  const existing = await findFiles(
    call,
    `${lit(input.folderId)} in parents and trashed = false and appProperties has { key='stKey' and value=${lit(input.dedupeKey)} }`,
  );
  if (existing[0]) return { id: existing[0].id, name: existing[0].name, reused: true };
  const boundary = `st${crypto.randomUUID().replace(/-/g, '')}`;
  const meta = JSON.stringify({
    name: input.name,
    mimeType: 'application/pdf',
    parents: [input.folderId],
    appProperties: { stKey: input.dedupeKey },
  });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.byteLength + input.bytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(input.bytes, head.byteLength);
  body.set(tail, head.byteLength + input.bytes.byteLength);
  const res = await call(
    `${UPLOAD}/files?uploadType=multipart&fields=id,name&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) {
    const e = await failFor(res, input.name);
    throw new IntegrationError('upload_failed', e.message, { retryable: res.status >= 500 });
  }
  return { ...((await res.json()) as { id: string; name: string }), reused: false };
}

/** A safe Drive file name from a document title. */
export function driveFileName(
  title: string,
  kind: 'signed' | 'certificate' | 'combined',
  opts: {
    naming?: 'title' | 'title_date';
    completedAt?: Date | null;
    certificateNumber?: string | null;
  } = {},
) {
  const clean =
    (title || 'Document')
      .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'Document';
  const date =
    opts.naming === 'title_date' && opts.completedAt
      ? ` ${opts.completedAt.toISOString().slice(0, 10)}`
      : '';
  if (kind === 'certificate')
    return `${clean}${date} - Certificate of Completion${opts.certificateNumber ? ` ${opts.certificateNumber}` : ''}.pdf`;
  if (kind === 'combined') return `${clean}${date} - Signed with Certificate.pdf`;
  return `${clean}${date} - Signed.pdf`;
}

// ---------------------------------------------------------------------------------------------
// Runtime

async function saveCompleted(a: ActionContext): Promise<ActionResult> {
  if (!a.requestId)
    throw new IntegrationError('invalid_record', 'This event has no finished document.', {
      retryable: false,
    });
  if (!a.storage) throw new IntegrationError('not_configured', 'File storage is not available.');
  const sf = alias(schema.documentFiles, 'sf');
  const cf = alias(schema.documentFiles, 'cf');
  const row = await withActor(a.db, a.actor, async (tx) => {
    const [r] = await tx
      .select({
        title: schema.signingRequests.title,
        documentId: schema.signingRequests.documentId,
        completedAt: schema.signingRequests.completedAt,
        certificateNumber: schema.signingRequests.certificateNumber,
        signedKey: sf.storageKey,
        certificateKey: cf.storageKey,
        settings: schema.integrationConnections.settings,
      })
      .from(schema.signingRequests)
      .leftJoin(sf, eq(sf.id, schema.signingRequests.signedFileId))
      .leftJoin(cf, eq(cf.id, schema.signingRequests.certificateFileId))
      .innerJoin(
        schema.integrationConnections,
        eq(schema.integrationConnections.id, a.connectionId),
      )
      .where(
        and(
          eq(schema.signingRequests.id, a.requestId!),
          eq(schema.signingRequests.workspaceId, a.workspaceId),
        ),
      );
    return r;
  });
  if (!row?.signedKey)
    throw new IntegrationError('not_found', 'The signed document is not available.', {
      retryable: false,
    });
  const s = readDriveSettings(row.settings);
  const folder = await resolveDriveFolder(a.call, s.folderId);
  const naming = {
    naming: s.naming,
    completedAt: row.completedAt,
    certificateNumber: row.certificateNumber,
  };
  const signedBytes = await a.storage.get(row.signedKey);
  const certBytes =
    row.certificateKey && (s.saveCertificate || s.saveCombined)
      ? await a.storage.get(row.certificateKey)
      : null;
  const uploads: { kind: 'signed' | 'certificate' | 'combined'; bytes: Uint8Array }[] = [];
  if (s.saveCombined && certBytes)
    uploads.push({ kind: 'combined', bytes: await buildCompletionPackage(signedBytes, certBytes) });
  else uploads.push({ kind: 'signed', bytes: signedBytes });
  if (s.saveCertificate && certBytes && !s.saveCombined)
    uploads.push({ kind: 'certificate', bytes: certBytes });

  const saved: { id: string; name: string }[] = [];
  for (const u of uploads) {
    const f = await uploadPdfToDrive(a.call, {
      folderId: folder.id,
      name: driveFileName(row.title, u.kind, naming),
      bytes: u.bytes,
      dedupeKey: `${a.requestId}:${u.kind}`,
    });
    saved.push({ id: f.id, name: f.name });
    await linkExternalRecord(a.db, a.actor, {
      connectionId: a.connectionId,
      externalObjectType: u.kind === 'certificate' ? 'certificate_file' : 'signed_file',
      externalObjectId: f.id,
      externalLabel: f.name,
      documentId: row.documentId,
      requestId: a.requestId,
    });
  }
  return {
    externalReference: saved.map((f) => f.id).join(','),
    output: { folder: folder.name, files: saved.map((f) => f.name) },
    message: `Saved ${saved.map((f) => f.name).join(' and ')} to ${folder.name}.`,
  };
}

registerConnectorRuntime('google_drive', {
  async fetchAccount(call) {
    const res = await call('https://openidconnect.googleapis.com/v1/userinfo');
    if (!res.ok) throw await failFor(res, 'Your Google account');
    const j = (await res.json()) as { sub: string; email?: string; name?: string };
    return { id: j.sub, label: j.email ?? j.name ?? 'Google account' };
  },
  async validate(call) {
    const res = await call(`${DRIVE}/about?fields=user(emailAddress)`);
    if (!res.ok) throw await failFor(res, 'Google Drive');
  },
  actions: { [DRIVE_SAVE_ACTION]: saveCompleted },
});

// ---------------------------------------------------------------------------------------------
// Member-facing services

/**
 * The Drive connection a member can use: their own personal one first, otherwise the workspace's.
 * Only active connections; RLS decides what the member can see.
 */
export async function findDriveConnection(db: Database, actor: ActorContext, workspaceId: string) {
  const c = schema.integrationConnections;
  return withActor(db, actor, async (tx) => {
    const rows = await tx
      .select({
        id: c.id,
        status: c.status,
        ownerUserId: c.ownerUserId,
        visibility: c.visibility,
        label: c.externalAccountLabel,
      })
      .from(c)
      .where(
        and(
          eq(c.workspaceId, workspaceId),
          eq(c.provider, 'google_drive'),
          or(eq(c.status, 'active'), eq(c.status, 'expired'), eq(c.status, 'permission_required')),
        ),
      )
      .orderBy(
        sql`case when ${c.ownerUserId} = ${actor.userId} then 0 else 1 end`,
        desc(c.connectedAt),
      );
    return rows[0] ?? null;
  });
}

async function canUse(db: Database, actor: ActorContext, workspaceId: string, perm: string) {
  return withActor(db, actor, async (tx) => {
    const [r] = (await tx.execute(
      sql`select st_has_permission(${workspaceId}::uuid, ${perm}) as ok`,
    )) as unknown as { ok: boolean }[];
    return Boolean(r?.ok);
  });
}

/**
 * A short-lived access token for the Google Picker, which runs in the browser and needs one to
 * show the member's files. The refresh token never leaves the server.
 */
export async function drivePickerToken(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  ctx: IntegrationContext,
): Promise<{ token: string; connectionId: string }> {
  if (
    !(await canUse(db, actor, workspaceId, 'integrations.use')) &&
    !(await canUse(db, actor, workspaceId, 'integrations.manage'))
  )
    throw new AppError('forbidden', 'Your role does not allow using connected apps.');
  const conn = await findDriveConnection(db, actor, workspaceId);
  if (!conn) throw new AppError('not_found', 'Connect Google Drive first.');
  if (conn.status !== 'active')
    throw new AppError(
      'conflict',
      'The Google Drive connection needs to be reconnected on the Integrations page.',
    );
  try {
    const { token } = await getAccessToken(db, actor, conn.id, ctx);
    return { token, connectionId: conn.id };
  } catch (err) {
    if (err instanceof IntegrationError)
      throw new AppError(
        err.code === 'auth_expired' ? 'conflict' : 'invalid',
        err.code === 'auth_expired'
          ? 'Google Drive access expired. Reconnect it on the Integrations page.'
          : err.message,
      );
    throw err;
  }
}

/**
 * Imports a file the member picked in the Google Picker into a new draft, through the ordinary
 * upload path, and links the draft to the Drive file. Logged in the integration activity.
 */
export async function importFromGoogleDrive(
  db: Database,
  storage: ObjectStorage,
  actor: ActorContext,
  workspaceId: string,
  fileId: string,
  ctx: IntegrationContext,
  limits: { maxBytes: number; maxPages: number },
  meta: Meta = {},
): Promise<{ documentId: string }> {
  const started = Date.now();
  const conn = await findDriveConnection(db, actor, workspaceId);
  if (!conn) throw new AppError('not_found', 'Connect Google Drive first.');
  if (conn.status !== 'active')
    throw new AppError(
      'conflict',
      'The Google Drive connection needs to be reconnected on the Integrations page.',
    );
  const log = (v: {
    status: 'success' | 'failed';
    documentId?: string;
    errorCode?: string;
    message: string;
  }) =>
    withActor(db, actor, (tx) =>
      logActivity(tx, {
        workspaceId,
        connectionId: conn.id,
        provider: 'google_drive',
        action: 'drive.import',
        status: v.status,
        actorUserId: actor.userId,
        documentId: v.documentId ?? null,
        externalReference: fileId,
        durationMs: Date.now() - started,
        errorCode: v.errorCode ?? null,
        message: v.message,
      }),
    ).catch(() => undefined);
  try {
    const call = await connectionCaller(db, actor, conn.id, ctx);
    const file = await getDriveFile(call, fileId);
    const { bytes, filename, exported } = await downloadDriveFileAsPdf(call, file, limits.maxBytes);
    const title = file.name.replace(/\.pdf$/i, '').slice(0, 200) || 'Untitled document';
    const { id } = await createDocumentFromUpload(
      db,
      storage,
      actor,
      { workspaceId, title, documentType: 'other', filename, bytes },
      limits,
      meta,
    );
    await setExternalRef(db, actor, id, {
      source: 'google_drive',
      id: file.id,
      metadata: { name: file.name.slice(0, 200), mimeType: file.mimeType },
    });
    await linkExternalRecord(db, actor, {
      connectionId: conn.id,
      externalObjectType: 'file',
      externalObjectId: file.id,
      externalLabel: file.name,
      documentId: id,
    });
    await log({
      status: 'success',
      documentId: id,
      message: `Imported ${sanitizeText(file.name, 120)}${exported ? ' (converted to PDF)' : ''}.`,
    });
    return { documentId: id };
  } catch (err) {
    const code =
      err instanceof IntegrationError ? err.code : err instanceof AppError ? err.code : 'internal';
    const message = err instanceof Error ? err.message : 'Import failed.';
    await log({ status: 'failed', errorCode: code, message });
    if (err instanceof IntegrationError)
      throw new AppError(
        err.code === 'not_found'
          ? 'not_found'
          : err.code === 'auth_expired'
            ? 'conflict'
            : 'invalid',
        err.code === 'auth_expired'
          ? 'Google Drive access expired. Reconnect it on the Integrations page.'
          : err.message,
      );
    throw err;
  }
}

/**
 * Turns automatic saving on or off for a Drive connection. Saving runs as an ordinary automation
 * ("when a signed document is ready, save it to Drive"), so it appears on the Automations page and
 * in the job log like any other.
 */
export async function setDriveAutoSave(
  db: Database,
  actor: ActorContext,
  workspaceId: string,
  connectionId: string,
  enabled: boolean,
  meta: Meta = {},
) {
  const existing = await withActor(db, actor, (tx) =>
    tx
      .select({
        id: schema.integrationEventSubscriptions.id,
        enabled: schema.integrationEventSubscriptions.enabled,
      })
      .from(schema.integrationEventSubscriptions)
      .where(
        and(
          eq(schema.integrationEventSubscriptions.connectionId, connectionId),
          eq(schema.integrationEventSubscriptions.action, DRIVE_SAVE_ACTION),
        ),
      ),
  );
  if (existing[0]) {
    if (existing[0].enabled !== enabled)
      await setAutomationEnabled(db, actor, existing[0].id, enabled, meta);
    return existing[0].id;
  }
  if (!enabled) return null;
  return createAutomation(
    db,
    actor,
    workspaceId,
    {
      connectionId,
      name: 'Save signed documents to Google Drive',
      eventType: SAVE_EVENT,
      action: DRIVE_SAVE_ACTION,
    },
    meta,
  );
}
