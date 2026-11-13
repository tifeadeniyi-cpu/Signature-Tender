import { NextResponse, type NextRequest } from 'next/server';
import { AppError, assertCanConnect, beginOAuth, buildAuthorizeUrl } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import {
  OAUTH_STATE_COOKIE,
  integrationContext,
  integrationSecretsReady,
  oauthRedirectUri,
} from '@/lib/integrations';

export const dynamic = 'force-dynamic';

function back(req: NextRequest, params: Record<string, string>) {
  const u = new URL('/app/integrations', req.url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u, 303);
}

/**
 * Starts connecting an app: checks the member's permission and that the connector can connect,
 * then sends them to the provider with a fresh state and PKCE challenge. The state and verifier
 * travel only in an encrypted, httpOnly, 10-minute cookie scoped to the callback.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const { user, membership } = await requireWorkspace();
  if (!integrationSecretsReady()) return back(req, { error: 'secrets_missing', provider });
  const visibility =
    req.nextUrl.searchParams.get('visibility') === 'personal' ? 'personal' : 'workspace';
  const ctx = await integrationContext();
  try {
    const def = await assertCanConnect(
      db(),
      { userId: user.id },
      membership.workspace.id,
      provider,
      visibility,
      ctx,
    );
    if (def.auth.type !== 'oauth2') return back(req, { error: 'unavailable', provider });
    const client = ctx.oauthClient(def.key)!;
    const { state, cookie } = beginOAuth(
      {
        provider: def.key,
        workspaceId: membership.workspace.id,
        userId: user.id,
        visibility,
        returnTo: '/app/integrations',
      },
      def.auth,
      ctx.keys.stateKey,
    );
    const res = NextResponse.redirect(
      buildAuthorizeUrl(def.auth, client, oauthRedirectUri(def.key), state),
      303,
    );
    res.cookies.set(OAUTH_STATE_COOKIE, cookie, {
      httpOnly: true,
      secure: req.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: `/api/integrations/oauth/${def.key}`,
      maxAge: 600,
    });
    return res;
  } catch (err) {
    if (err instanceof AppError)
      return back(req, { error: err.code === 'forbidden' ? 'forbidden' : 'unavailable', provider });
    throw err;
  }
}
