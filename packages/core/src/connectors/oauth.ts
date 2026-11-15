import { createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../webhooks';
import { IntegrationError, type OAuthConfig, type ProviderFetch, type TokenSet } from './types';
import type { OAuthClient } from './registry';

/**
 * OAuth 2.0 authorization-code flow shared by every connector: state and PKCE, the authorize URL,
 * the code exchange and refresh. Tokens are exchanged on the server only.
 */

// ---------------------------------------------------------------------------------------------
// Keys. Both are derived from one server secret with different labels, so the token key and the
// state-cookie key are independent of each other and of the webhook-secrets key.

function derive(serverSecret: string, label: string): Buffer {
  if (!serverSecret || serverSecret.length < 32)
    throw new Error('The secrets encryption key must be at least 32 characters');
  return Buffer.from(hkdfSync('sha256', serverSecret, 'signature-tender', label, 32));
}

export interface IntegrationKeys {
  tokenKey: Buffer;
  stateKey: Buffer;
}

export function deriveIntegrationKeys(serverSecret: string): IntegrationKeys {
  return {
    tokenKey: derive(serverSecret, 'integration-tokens-v1'),
    stateKey: derive(serverSecret, 'integration-oauth-state-v1'),
  };
}

// ---------------------------------------------------------------------------------------------
// State and PKCE.

export interface OAuthState {
  state: string;
  verifier: string | null;
  provider: string;
  workspaceId: string;
  userId: string;
  visibility: 'workspace' | 'personal';
  /** Where to send the person afterwards (an /app path). */
  returnTo: string;
  expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Starts a flow: a random state, a PKCE verifier when the provider uses PKCE, and the sealed cookie. */
export function beginOAuth(
  input: Omit<OAuthState, 'state' | 'verifier' | 'expiresAt'>,
  cfg: OAuthConfig,
  key: Buffer,
  now = Date.now(),
): { state: OAuthState; cookie: string } {
  const state: OAuthState = {
    ...input,
    state: randomBytes(32).toString('base64url'),
    verifier: cfg.pkce ? randomBytes(48).toString('base64url') : null,
    expiresAt: now + STATE_TTL_MS,
  };
  return { state, cookie: encryptSecret(JSON.stringify(state), key) };
}

/**
 * Checks the callback against the sealed cookie: the cookie must decrypt, be unexpired, be for this
 * provider and signed-in user, and its state must equal the returned state (constant time).
 */
export function verifyOAuthState(
  cookie: string | undefined,
  returnedState: string | null,
  expected: { provider: string; userId: string },
  key: Buffer,
  now = Date.now(),
): OAuthState {
  if (!cookie || !returnedState)
    throw new IntegrationError('invalid_request', 'Missing OAuth state.');
  let s: OAuthState;
  try {
    s = JSON.parse(decryptSecret(cookie, key)) as OAuthState;
  } catch {
    throw new IntegrationError('invalid_request', 'Invalid OAuth state.');
  }
  const a = Buffer.from(s.state ?? '');
  const b = Buffer.from(returnedState);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new IntegrationError('invalid_request', 'OAuth state does not match.');
  if (s.expiresAt < now)
    throw new IntegrationError('invalid_request', 'The sign-in took too long.');
  if (s.provider !== expected.provider || s.userId !== expected.userId)
    throw new IntegrationError('invalid_request', 'OAuth state is for a different sign-in.');
  return s;
}

export function buildAuthorizeUrl(
  cfg: OAuthConfig,
  client: Pick<OAuthClient, 'clientId'>,
  redirectUri: string,
  state: OAuthState,
): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', client.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', cfg.scopes.join(cfg.scopeSeparator ?? ' '));
  u.searchParams.set('state', state.state);
  if (state.verifier) {
    u.searchParams.set('code_challenge', pkceChallenge(state.verifier));
    u.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(cfg.authorizeParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

// ---------------------------------------------------------------------------------------------
// Token endpoint.

function assertProviderUrl(url: string, allowed: string[]) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !allowed.includes(u.hostname))
    throw new IntegrationError('internal', `Refusing to call ${u.hostname}.`);
}

async function tokenRequest(
  cfg: OAuthConfig,
  client: OAuthClient,
  params: Record<string, string>,
  fetchFn: ProviderFetch,
  now: number,
): Promise<TokenSet> {
  assertProviderUrl(cfg.tokenUrl, [new URL(cfg.tokenUrl).hostname]);
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (cfg.clientAuth === 'basic') {
    headers.authorization = `Basic ${Buffer.from(
      `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`,
    ).toString('base64')}`;
  } else {
    body.set('client_id', client.clientId);
    body.set('client_secret', client.clientSecret);
  }
  let res: Response;
  try {
    res = await fetchFn(cfg.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new IntegrationError('provider_unavailable', 'The provider did not respond.');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(json.error ?? '');
    if (err === 'invalid_grant')
      throw new IntegrationError('auth_expired', 'The authorization has expired or was revoked.', {
        retryable: false,
      });
    if (res.status === 429)
      throw new IntegrationError('rate_limited', 'The provider is rate limiting.');
    if (res.status >= 500)
      throw new IntegrationError('provider_unavailable', 'The provider had an error.');
    throw new IntegrationError(
      'invalid_request',
      `The provider refused the request (${err || res.status}).`,
      {
        retryable: false,
      },
    );
  }
  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  if (!accessToken)
    throw new IntegrationError('internal', 'The provider returned no access token.');
  const expiresIn = Number(json.expires_in);
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now + expiresIn * 1000) : null,
    scopes:
      typeof json.scope === 'string' ? json.scope.split(/[\s,]+/).filter(Boolean) : [...cfg.scopes],
  };
}

export function exchangeCode(
  cfg: OAuthConfig,
  client: OAuthClient,
  args: { code: string; redirectUri: string; verifier: string | null },
  fetchFn: ProviderFetch = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  const params: Record<string, string> = {
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
  };
  if (args.verifier) params.code_verifier = args.verifier;
  return tokenRequest(cfg, client, params, fetchFn, now);
}

export async function refreshTokens(
  cfg: OAuthConfig,
  client: OAuthClient,
  refreshToken: string,
  fetchFn: ProviderFetch = fetch,
  now = Date.now(),
): Promise<TokenSet> {
  const t = await tokenRequest(
    cfg,
    client,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchFn,
    now,
  );
  // Providers that do not rotate refresh tokens leave it out of the response: keep the old one.
  return { ...t, refreshToken: t.refreshToken ?? refreshToken };
}

/** Best-effort revocation at the provider when disconnecting. Never throws. */
export async function revokeAtProvider(
  cfg: OAuthConfig,
  token: string,
  fetchFn: ProviderFetch = fetch,
): Promise<boolean> {
  if (!cfg.revokeUrl) return false;
  try {
    const res = await fetchFn(cfg.revokeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * A fetch that only reaches the connector's declared API hosts over HTTPS and never follows
 * redirects elsewhere, so a connector cannot be pointed at internal addresses.
 */
export function scopedProviderFetch(cfg: OAuthConfig, fetchFn: ProviderFetch = fetch) {
  return (url: string, init: RequestInit = {}) => {
    assertProviderUrl(url, cfg.apiHosts);
    return fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), ...init });
  };
}
