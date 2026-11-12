import 'server-only';
import { after } from 'next/server';
import {
  deriveSecretsKey,
  dispatchWebhooks,
  getConfigValue,
  isFeatureEnabled,
  type WebhookContext,
} from '@st/core';
import { db } from './db';
import { env } from './env';

let key: Buffer | undefined;

/** Encryption key and destination rules for webhook endpoints. */
export function webhookContext(): WebhookContext {
  const e = env();
  key ??= deriveSecretsKey(e.WEBHOOK_SECRETS_KEY ?? e.BETTER_AUTH_SECRET);
  return {
    encKey: key,
    urlPolicy: { allowLocalhost: e.APP_ENV === 'development' || e.APP_ENV === 'test' },
  };
}

/** Sends due webhooks. Called from the cron route and, opportunistically, after API writes. */
export async function runWebhookDispatch() {
  if (!(await isFeatureEnabled(db(), 'public_api', env().APP_ENV))) return null;
  const maxAttempts = await getConfigValue(db(), 'webhooks.max_attempts', 8);
  return dispatchWebhooks(db(), { ...webhookContext(), maxAttempts });
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
