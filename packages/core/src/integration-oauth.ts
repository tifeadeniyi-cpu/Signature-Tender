import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decryptSecret, encryptSecret } from './webhooks';

/**
 * OAuth helpers shared by every connector. The state and PKCE verifier travel in a sealed,
 * short-lived httpOnly cookie (AES-256-GCM, so it cannot be read or altered), bound to the member
 * and workspace that started the flow.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry of the access token. */
  expiresAt: Date | null;
  scopes: string[];
}

export interface PendingOAuth {
  provider: string;
  state: string;
  verifier: string;
  userId: string;
  workspaceId: string;
  returnTo: string;
  createdAt: number;
}

const pendingSchema = z.object({
  provider: z.string(),
  state: z.string().min(32),
  verifier: z.string().min(43),
  userId: z.string(),
  workspaceId: z.string().uuid(),
  returnTo: z.string().startsWith('/'),
  createdAt: z.number(),
});

/** RFC 7636 S256 code challenge. */
export function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Starts a flow: returns the sealed cookie value and the values for the authorization URL. */
export function beginOAuth(
  input: Omit<PendingOAuth, 'state' | 'verifier' | 'createdAt'>,
  encKey: Buffer,
  now = Date.now(),
) {
  const pending: PendingOAuth = {
    ...input,
    returnTo:
      input.returnTo.startsWith('/') && !input.returnTo.startsWith('//')
        ? input.returnTo
        : '/app/integrations',
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    createdAt: now,
  };
  return {
    cookie: encryptSecret(JSON.stringify(pending), encKey),
    state: pending.state,
    challenge: pkceChallenge(pending.verifier),
  };
}

export type OAuthCheckFailure =
  'missing' | 'tampered' | 'expired' | 'state_mismatch' | 'wrong_user';

/**
 * Validates the callback against the cookie. The state must match exactly, the flow must be
 * recent, and the member finishing it must be the one who started it.
 */
export function completeOAuth(
  cookie: string | undefined,
  params: { state: string | null; provider: string; userId: string },
  encKey: Buffer,
  now = Date.now(),
): { ok: true; pending: PendingOAuth } | { ok: false; reason: OAuthCheckFailure } {
  if (!cookie) return { ok: false, reason: 'missing' };
  let pending: PendingOAuth;
  try {
    pending = pendingSchema.parse(JSON.parse(decryptSecret(cookie, encKey)));
  } catch {
    return { ok: false, reason: 'tampered' };
  }
  if (now - pending.createdAt > STATE_TTL_MS || pending.createdAt > now + 60_000)
    return { ok: false, reason: 'expired' };
  if (
    !params.state ||
    params.state.length !== pending.state.length ||
    params.state !== pending.state ||
    pending.provider !== params.provider
  )
    return { ok: false, reason: 'state_mismatch' };
  if (pending.userId !== params.userId) return { ok: false, reason: 'wrong_user' };
  return { ok: true, pending };
}

/** Seals tokens for storage. */
export function sealTokens(t: Pick<OAuthTokens, 'accessToken' | 'refreshToken'>, encKey: Buffer) {
  return encryptSecret(JSON.stringify({ a: t.accessToken, r: t.refreshToken }), encKey);
}

export function openTokens(sealed: string, encKey: Buffer) {
  const v = JSON.parse(decryptSecret(sealed, encKey)) as { a: string; r: string | null };
  return { accessToken: v.a, refreshToken: v.r };
}

/**
 * A failure talking to a provider, classified so the worker knows whether to retry.
 * `auth_revoked`: the user withdrew access or the refresh token is no longer valid (reconnect).
 */
export type IntegrationErrorCode =
  | 'auth_expired'
  | 'auth_revoked'
  | 'permission_denied'
  | 'not_found'
  | 'unsupported_file'
  | 'file_too_large'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'missing_file'
  | 'invalid_config'
  | 'unknown';

export class IntegrationError extends Error {
  constructor(
    readonly code: IntegrationErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'IntegrationError';
  }

  /** Retrying will not help. */
  get permanent() {
    return [
      'auth_revoked',
      'permission_denied',
      'not_found',
      'unsupported_file',
      'file_too_large',
      'missing_file',
      'invalid_config',
    ].includes(this.code);
  }
}
