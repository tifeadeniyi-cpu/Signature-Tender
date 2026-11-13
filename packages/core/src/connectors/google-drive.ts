import { IntegrationError, type OAuthTokens } from '../integration-oauth';

/**
 * Google Drive connector. Uses the `drive.file` scope: the app sees only files the user picks in
 * the Google Picker and files the app itself creates, never the rest of the Drive.
 * https://developers.google.com/workspace/drive/api/guides/api-specific-auth
 */

export const GOOGLE_DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
];

export interface GoogleOAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Fetch = typeof fetch;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Google editor files are exported to PDF; everything else must already be a PDF. */
const EXPORTABLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

export function isImportableMime(mime: string) {
  return mime === 'application/pdf' || EXPORTABLE.has(mime);
}

export function googleAuthorizationUrl(
  client: Pick<GoogleOAuthClient, 'clientId' | 'redirectUri'>,
  state: string,
  challenge: string,
  loginHint?: string,
) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPES.join(' '),
    access_type: 'offline',
    // Ask again so Google returns a refresh token even if the account authorized us before.
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return u.toString();
}

async function asError(res: Response, what: string): Promise<IntegrationError> {
  let reason = '';
  try {
    const j = (await res.json()) as {
      error?: string | { message?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
    reason =
      typeof j.error === 'string'
        ? j.error
        : (j.error?.errors?.[0]?.reason ?? j.error?.message ?? '');
  } catch {
    /* not JSON */
  }
  const s = res.status;
  if (reason === 'invalid_grant')
    return new IntegrationError(
      'auth_revoked',
      'Google access was withdrawn. Reconnect Google Drive.',
      s,
    );
  if (s === 401) return new IntegrationError('auth_expired', 'Google sign-in expired.', s);
  if (s === 404) return new IntegrationError('not_found', `${what}: not found in Google Drive.`, s);
  if (s === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')
    return new IntegrationError(
      'rate_limited',
      'Google Drive is limiting requests. Will retry.',
      s,
    );
  if (s === 403 && (reason === 'insufficientPermissions' || reason === 'appNotAuthorizedToFile'))
    return new IntegrationError(
      'permission_denied',
      `${what}: Signature Tender does not have access to this file.`,
      s,
    );
  if (s === 403 && reason === 'cannotExportFile')
    return new IntegrationError(
      'unsupported_file',
      `${what}: Google cannot export this file to PDF.`,
      s,
    );
  if (s === 403 && reason === 'exportSizeLimitExceeded')
    return new IntegrationError(
      'file_too_large',
      `${what}: the file is too large for Google to export.`,
      s,
    );
  if (s === 403 && reason === 'storageQuotaExceeded')
    return new IntegrationError('permission_denied', 'The Google Drive is full.', s);
  if (s === 403)
    return new IntegrationError('permission_denied', `${what}: access denied by Google.`, s);
  if (s >= 500)
    return new IntegrationError(
      'provider_unavailable',
      'Google Drive is unavailable. Will retry.',
      s,
    );
  return new IntegrationError('unknown', `${what}: Google returned HTTP ${s}.`, s);
}

function tokensFrom(j: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}): OAuthTokens {
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
    scopes: j.scope ? j.scope.split(' ') : [],
  };
}

export async function exchangeGoogleCode(
  client: GoogleOAuthClient,
  code: string,
  verifier: string,
  f: Fetch = fetch,
): Promise<OAuthTokens> {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw await asError(res, 'Authorization');
  return tokensFrom(await res.json());
}

export async function refreshGoogleToken(
  client: Pick<GoogleOAuthClient, 'clientId' | 'clientSecret'>,
  refreshToken: string,
  f: Fetch = fetch,
): Promise<OAuthTokens> {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const err = await asError(res, 'Token refresh');
    // A refresh that is refused for any 4xx reason means the grant is gone.
    if (res.status === 400 || res.status === 401)
      throw new IntegrationError(
        'auth_revoked',
        'Google access was withdrawn. Reconnect Google Drive.',
        res.status,
      );
    throw err;
  }
  const t = tokensFrom(await res.json());
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

export async function revokeGoogleToken(token: string, f: Fetch = fetch) {
  await f(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

export async function googleAccount(accessToken: string, f: Fetch = fetch) {
  const res = await f(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw await asError(res, 'Account');
  const j = (await res.json()) as { sub: string; email?: string; name?: string };
  return { id: j.sub, label: j.email ?? j.name ?? 'Google account' };
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

export async function getDriveFile(accessToken: string, fileId: string, f: Fetch = fetch) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
    throw new IntegrationError('not_found', 'That is not a Google Drive file id.');
  const u = `${DRIVE}/files/${fileId}?fields=id,name,mimeType,size,trashed&supportsAllDrives=true`;
  const res = await f(u, { headers: auth(accessToken) });
  if (!res.ok) throw await asError(res, 'File');
  const j = (await res.json()) as DriveFile & { trashed?: boolean };
  if (j.trashed) throw new IntegrationError('not_found', 'That file is in the Google Drive trash.');
  return j;
}

/**
 * Downloads a picked file as PDF bytes. PDFs are downloaded as they are; Google Docs, Sheets and
 * Slides are exported to PDF so the signed document is a fixed, stable representation.
 */
export async function downloadDriveFileAsPdf(
  accessToken: string,
  file: DriveFile,
  maxBytes: number,
  f: Fetch = fetch,
): Promise<{ bytes: Uint8Array; filename: string }> {
  if (!isImportableMime(file.mimeType))
    throw new IntegrationError(
      'unsupported_file',
      'Only PDFs and Google Docs, Sheets and Slides can be imported. Save other files as PDF first.',
    );
  if (file.size && Number(file.size) > maxBytes)
    throw new IntegrationError('file_too_large', 'That file is larger than the upload limit.');
  const exported = file.mimeType !== 'application/pdf';
  const u = exported
    ? `${DRIVE}/files/${file.id}/export?mimeType=application%2Fpdf`
    : `${DRIVE}/files/${file.id}?alt=media&supportsAllDrives=true`;
  const res = await f(u, { headers: auth(accessToken) });
  if (!res.ok) throw await asError(res, file.name);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new IntegrationError('file_too_large', 'That file is larger than the upload limit.');
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes)
    throw new IntegrationError('file_too_large', 'That file is larger than the upload limit.');
  const base = file.name.replace(/\.pdf$/i, '');
  return { bytes, filename: `${base}.pdf` };
}

/** Escapes a value for a Drive `q` string literal. */
const lit = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function listFiles(accessToken: string, q: string, f: Fetch) {
  const u = new URL(`${DRIVE}/files`);
  u.search = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType)',
    pageSize: '10',
    spaces: 'drive',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  }).toString();
  const res = await f(u, { headers: auth(accessToken) });
  if (!res.ok) throw await asError(res, 'Folder');
  return ((await res.json()) as { files: DriveFile[] }).files;
}

/**
 * The folder signed copies go to: the folder the user picked, or a "Signature Tender" folder the
 * app creates (and can find again, since apps see their own files under drive.file).
 */
export async function resolveDriveFolder(
  accessToken: string,
  folderId: string | null | undefined,
  f: Fetch = fetch,
): Promise<{ id: string; name: string }> {
  if (folderId) {
    const meta = await getDriveFile(accessToken, folderId, f);
    if (meta.mimeType !== DRIVE_FOLDER_MIME)
      throw new IntegrationError('invalid_config', 'The chosen save location is not a folder.');
    return { id: meta.id, name: meta.name };
  }
  const found = await listFiles(
    accessToken,
    `name = 'Signature Tender' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false and appProperties has { key='stFolder' and value='default' }`,
    f,
  );
  if (found[0]) return { id: found[0].id, name: found[0].name };
  const res = await f(`${DRIVE}/files?fields=id,name&supportsAllDrives=true`, {
    method: 'POST',
    headers: { ...auth(accessToken), 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Signature Tender',
      mimeType: DRIVE_FOLDER_MIME,
      appProperties: { stFolder: 'default' },
    }),
  });
  if (!res.ok) throw await asError(res, 'Folder');
  return (await res.json()) as { id: string; name: string };
}

/**
 * Uploads a PDF into a folder. `dedupeKey` is stored as an app property; if a file with the same
 * key already exists in the folder (a retry after a lost response) it is returned instead of
 * uploading a duplicate.
 */
export async function uploadPdfToDrive(
  accessToken: string,
  input: { folderId: string; name: string; bytes: Uint8Array; dedupeKey: string },
  f: Fetch = fetch,
): Promise<{ id: string; name: string; reused: boolean }> {
  const existing = await listFiles(
    accessToken,
    `${lit(input.folderId)} in parents and trashed = false and appProperties has { key='stKey' and value=${lit(input.dedupeKey)} }`,
    f,
  );
  if (existing[0]) return { id: existing[0].id, name: existing[0].name, reused: true };
  const boundary = `st${crypto.randomUUID().replace(/-/g, '')}`;
  const meta = JSON.stringify({
    name: input.name,
    mimeType: 'application/pdf',
    parents: [input.folderId],
    appProperties: { stKey: input.dedupeKey },
  });
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.byteLength + input.bytes.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(input.bytes, head.byteLength);
  body.set(tail, head.byteLength + input.bytes.byteLength);
  const res = await f(
    `${UPLOAD}/files?uploadType=multipart&fields=id,name&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { ...auth(accessToken), 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!res.ok) throw await asError(res, input.name);
  const j = (await res.json()) as { id: string; name: string };
  return { ...j, reused: false };
}

/** A safe Drive file name from a document title. */
export function driveFileName(
  title: string,
  kind: 'signed' | 'certificate',
  opts: {
    naming?: 'title' | 'title_date';
    completedAt?: Date | null;
    certificateNumber?: string | null;
  },
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
  return `${clean}${date} - Signed.pdf`;
}
