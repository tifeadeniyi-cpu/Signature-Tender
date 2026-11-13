import 'server-only';
import { after } from 'next/server';
import {
  deriveIntegrationKeys,
  isFeatureEnabled,
  runIntegrationJobs,
  type IntegrationContext,
  type IntegrationKeys,
  type OAuthClient,
} from '@st/core';
import { db } from './db';
import { env } from './env';

let keys: IntegrationKeys | undefined;

/** OAuth app credentials for a connector, from the server environment. Never sent to the browser. */
export function oauthClientFor(provider: string): OAuthClient | null {
  const e = env();
  const pick = (id?: string, secret?: string) =>
    id && secret ? { clientId: id, clientSecret: secret } : null;
  switch (provider) {
    case 'google_drive':
      return (
        pick(e.GOOGLE_DRIVE_CLIENT_ID, e.GOOGLE_DRIVE_CLIENT_SECRET) ??
        pick(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET)
      );
    case 'hubspot':
      return pick(e.HUBSPOT_CLIENT_ID, e.HUBSPOT_CLIENT_SECRET);
    default:
      return null;
  }
}

/** True when tokens can be encrypted on this server (production needs WEBHOOK_SECRETS_KEY). */
export function integrationSecretsReady(): boolean {
  const e = env();
  return e.APP_ENV !== 'production' || Boolean(e.WEBHOOK_SECRETS_KEY);
}

/**
 * Settings for the integration services. Token encryption derives its own key from
 * WEBHOOK_SECRETS_KEY (falling back to the session secret outside production, as webhooks do),
 * with a different label, so it never shares a key with webhook secrets.
 */
export async function integrationContext(): Promise<IntegrationContext> {
  const e = env();
  if (!integrationSecretsReady())
    throw new Error(
      'WEBHOOK_SECRETS_KEY must be set in production before integrations can connect.',
    );
  keys ??= deriveIntegrationKeys(e.WEBHOOK_SECRETS_KEY ?? e.BETTER_AUTH_SECRET);
  return {
    keys,
    oauthClient: (p) => (integrationSecretsReady() ? oauthClientFor(p) : null),
    featureEnabled: await isFeatureEnabled(db(), 'integrations', e.APP_ENV),
  };
}

/** The OAuth redirect URI registered with each provider. */
export function oauthRedirectUri(provider: string): string {
  return new URL(`/api/integrations/oauth/${provider}/callback`, env().BETTER_AUTH_URL).toString();
}

export const OAUTH_STATE_COOKIE = 'st_integration_oauth';

/** Runs due integration jobs. Called by the cron route and after actions that queue work. */
export async function runIntegrationJobQueue() {
  return runIntegrationJobs(db(), await integrationContext(), { limit: 20 });
}

/** After the response is sent, run any integration jobs that are now due. Never throws. */
export function kickIntegrationJobs() {
  after(() =>
    runIntegrationJobQueue().then(
      () => undefined,
      (err) => console.error('[integrations] job run failed', err),
    ),
  );
}
