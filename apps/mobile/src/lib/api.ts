import { authClient } from './auth';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

let workspaceId: string | null = null;
/** The workspace the app is showing; sent with every call, and re-checked by the server. */
export function setWorkspace(id: string | null) {
  workspaceId = id;
}

let onSignedOut: (() => void) | null = null;
/** Called when the server says the session has ended, so the app can return to sign-in. */
export function onSessionEnded(fn: () => void) {
  onSignedOut = fn;
}

/** Headers that carry the session, exactly as the Expo auth client stores it. */
export async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  const cookie = await authClient.getCookie();
  if (cookie) h.Cookie = cookie;
  if (workspaceId) h['x-st-workspace'] = workspaceId;
  return h;
}

/** Calls the Signature Tender API with the session. Errors carry the server's plain message. */
export async function api<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      signal: init.signal,
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(await authHeaders()),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('We could not reach Signature Tender. Check your connection and try again.', 0);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok || body === null) {
    const b = (body ?? {}) as { error?: string; code?: string };
    if (res.status === 401) onSignedOut?.();
    throw new ApiError(
      b.error ??
        (res.status === 404
          ? 'This is not available. It may have been deleted, or you may not have access.'
          : 'Something went wrong. Please try again.'),
      res.status,
      b.code,
    );
  }
  return body as T;
}

export const qs = (params: Record<string, string | number | null | undefined>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};
