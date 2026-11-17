import 'server-only';
import { after } from 'next/server';
import {
  AppError,
  deriveSecretsKey,
  dispatchWebhooks,
  getConfigValue,
  isFeatureEnabled,
  type WebhookContext,
} from '@st/core';
import { db } from './db';
import { env } from './env';

let key: Buffer | undefined;

/** Shown wherever webhooks or connections are offered but the encryption key is missing. */
export const WEBHOOKS_NOT_READY =
  'Webhooks and app connections are not switched on for this site yet. API keys still work. ' +
  'The site owner needs to add the webhook encryption key in the hosting settings.';

/**
 * Whether webhook endpoints can be created here. In production the webhook key must be its
 * own secret, so rotating the session secret can never make stored webhook secrets unreadable,
 * and one leaked value does not expose both.
 */
export function webhooksReady(): boolean {
  const e = env();
  return e.APP_ENV !== 'production' || Boolean(e.WEBHOOK_SECRETS_KEY);
}

/** Encryption key and destination rules for webhook endpoints. */
export function webhookContext(): WebhookContext {
  const e = env();
  // An AppError, so forms show the reason instead of a generic failure page.
  if (!webhooksReady()) throw new AppError('conflict', WEBHOOKS_NOT_READY);
  key ??= deriveSecretsKey(e.WEBHOOK_SECRETS_KEY ?? e.BETTER_AUTH_SECRET);
  return {
    encKey: key,
    urlPolicy: { allowLocalhost: e.APP_ENV === 'development' || e.APP_ENV === 'test' },
  };
}

/** Sends due webhooks. Called from the cron route and, opportunistically, after API writes. */
export async function runWebhookDispatch() {
  if (!webhooksReady()) return null;
  if (!(await isFeatureEnabled(db(), 'public_api', env().APP_ENV))) return null;
  const maxAttempts = await getConfigValue(db(), 'webhooks.max_attempts', 8);
  return dispatchWebhooks(db(), {
    ...webhookContext(),
    maxAttempts,
    appUrl: env().BETTER_AUTH_URL,
  });
}

/** After the response is sent, deliver any webhooks the request just caused. Never throws. */
export function kickWebhooks() {
  after(() =>
    runWebhookDispatch().then(
      () => undefined,
      () => undefined,
    ),
  );
}
