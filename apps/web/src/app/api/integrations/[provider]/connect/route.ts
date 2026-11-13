import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  beginOAuth,
  getIntegration,
  googleAuthorizationUrl,
  hasPermission,
  canConnect,
} from '@st/core';
import { requireWorkspace } from '@/lib/session';
import { env } from '@/lib/env';
import {
  OAUTH_COOKIE,
  availabilityOf,
  googleDriveClient,
  integrationRuntime,
} from '@/lib/integrations';

export const dynamic = 'force-dynamic';

/**
 * Starts an OAuth connection: checks the member may connect, seals state + PKCE verifier in a
 * short-lived httpOnly cookie and sends the browser to the provider's consent screen.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const { user, membership } = await requireWorkspace();
  const back = (q: string) =>
    NextResponse.redirect(
      new URL(`/app/integrations/${provider}?${q}`, env().BETTER_AUTH_URL),
      303,
    );
  const info = getIntegration(provider);
  if (!info || info.kind !== 'oauth' || !canConnect(await availabilityOf(info)))
    return back('error=unavailable');
  if (!hasPermission(membership.permissions, 'integrations.manage')) return back('error=forbidden');
  const client = provider === 'google_drive' ? googleDriveClient() : undefined;
  if (!client) return back('error=unavailable');
  const returnTo = new URL(req.url).searchParams.get('returnTo') ?? `/app/integrations/${provider}`;
  const flow = beginOAuth(
    { provider, userId: user.id, workspaceId: membership.workspace.id, returnTo },
    integrationRuntime().encKey,
  );
  (await cookies()).set(OAUTH_COOKIE, flow.cookie, {
    httpOnly: true,
    secure: env().APP_ENV === 'production' || env().APP_ENV === 'staging',
    sameSite: 'lax',
    path: '/api/integrations',
    maxAge: 600,
  });
  return NextResponse.redirect(googleAuthorizationUrl(client, flow.state, flow.challenge), 303);
}
