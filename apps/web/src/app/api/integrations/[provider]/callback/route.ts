import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  AppError,
  IntegrationError,
  completeOAuth,
  exchangeGoogleCode,
  saveOAuthConnection,
} from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getSession, requestMeta } from '@/lib/session';
import { OAUTH_COOKIE, googleDriveClient, integrationRuntime } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

/**
 * The provider sends the browser back here. Verifies the sealed state (same member, same flow,
 * under ten minutes old), exchanges the code with the PKCE verifier and stores the connection.
 * Cancelling at the provider returns quietly with a message.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const jar = await cookies();
  const cookie = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: '/api/integrations' });
  const to = (path: string, q: string) =>
    NextResponse.redirect(
      new URL(`${path}${path.includes('?') ? '&' : '?'}${q}`, env().BETTER_AUTH_URL),
      303,
    );
  const detail = `/app/integrations/${encodeURIComponent(provider)}`;

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/sign-in', env().BETTER_AUTH_URL), 303);
  const rt = integrationRuntime();
  const check = completeOAuth(
    cookie,
    { state: url.searchParams.get('state'), provider, userId: session.user.id },
    rt.encKey,
  );
  if (!check.ok) return to(detail, 'error=state');
  const { pending } = check;
  if (url.searchParams.get('error'))
    return to(
      pending.returnTo,
      url.searchParams.get('error') === 'access_denied' ? 'error=cancelled' : 'error=provider',
    );
  const code = url.searchParams.get('code');
  const client = provider === 'google_drive' ? googleDriveClient() : undefined;
  if (!code || !client) return to(pending.returnTo, 'error=provider');
  try {
    const tokens = await exchangeGoogleCode(client, code, pending.verifier);
    if (!tokens.scopes.includes('https://www.googleapis.com/auth/drive.file'))
      return to(pending.returnTo, 'error=scope');
    await saveOAuthConnection(
      db(),
      { userId: session.user.id },
      pending.workspaceId,
      provider,
      tokens,
      rt,
      await requestMeta(),
    );
    return to(pending.returnTo, 'connected=1');
  } catch (err) {
    console.error(
      '[integrations] OAuth callback failed',
      provider,
      err instanceof Error ? err.message : err,
    );
    if (err instanceof AppError && err.code === 'forbidden')
      return to(pending.returnTo, 'error=forbidden');
    if (err instanceof IntegrationError || err instanceof AppError)
      return to(pending.returnTo, 'error=provider');
    return to(pending.returnTo, 'error=provider');
  }
}
