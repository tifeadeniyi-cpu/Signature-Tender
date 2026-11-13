import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  IntegrationError,
  completeOAuthConnection,
  exchangeCode,
  getConnector,
  recordOAuthFailure,
  verifyOAuthState,
} from '@st/core';
import { db } from '@/lib/db';
import { requestMeta, requireUser } from '@/lib/session';
import { OAUTH_STATE_COOKIE, integrationContext, oauthRedirectUri } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

function done(req: NextRequest, provider: string, params: Record<string, string>) {
  const u = new URL('/app/integrations', req.url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = NextResponse.redirect(u, 303);
  res.cookies.set(OAUTH_STATE_COOKIE, '', {
    path: `/api/integrations/oauth/${provider}`,
    maxAge: 0,
  });
  return res;
}

/**
 * The provider sends the member back here. The state must match the encrypted cookie set when the
 * flow started, for the same provider and signed-in user, within 10 minutes. The code is exchanged
 * on the server and the tokens are encrypted before they are stored. Nothing secret is put in the
 * redirect back to the app.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const def = getConnector(provider);
  if (!def || def.auth.type !== 'oauth2') return done(req, provider, { error: 'unavailable' });
  const user = await requireUser();
  const actor = { userId: user.id };
  const ctx = await integrationContext();
  const q = req.nextUrl.searchParams;

  let state;
  try {
    state = verifyOAuthState(
      req.cookies.get(OAUTH_STATE_COOKIE)?.value,
      q.get('state'),
      { provider: def.key, userId: user.id },
      ctx.keys.stateKey,
    );
  } catch {
    return done(req, provider, { error: 'state', provider });
  }

  const providerError = q.get('error');
  if (providerError) {
    const cancelled = providerError === 'access_denied';
    await recordOAuthFailure(
      db(),
      actor,
      state.workspaceId,
      def.key,
      cancelled ? 'cancelled' : 'failed',
      cancelled
        ? 'Authorization was cancelled.'
        : `The provider returned ${providerError.slice(0, 60)}.`,
    ).catch(() => undefined);
    return done(req, provider, { error: cancelled ? 'cancelled' : 'provider', provider });
  }
  const code = q.get('code');
  const client = ctx.oauthClient(def.key);
  if (!code || !client) return done(req, provider, { error: 'provider', provider });

  try {
    const tokens = await exchangeCode(
      def.auth,
      client,
      { code, redirectUri: oauthRedirectUri(def.key), verifier: state.verifier },
      ctx.fetch,
    );
    await completeOAuthConnection(
      db(),
      actor,
      { workspaceId: state.workspaceId, provider: def.key, visibility: state.visibility, tokens },
      ctx,
      await requestMeta(),
    );
    return done(req, provider, { connected: provider });
  } catch (err) {
    if (err instanceof IntegrationError || err instanceof AppError) {
      await recordOAuthFailure(
        db(),
        actor,
        state.workspaceId,
        def.key,
        'failed',
        err.message,
      ).catch(() => undefined);
      return done(req, provider, {
        error: err instanceof AppError && err.code === 'forbidden' ? 'forbidden' : 'provider',
        provider,
      });
    }
    throw err;
  }
}
