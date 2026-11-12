import 'server-only';
import { isFeatureEnabled } from '@st/core';
import { db } from './db';
import { env } from './env';
import { stripeConfigured } from './stripe';

/** Whether customers can pay: the payments flag is on and Stripe keys are present. */
export async function paymentsAvailable(): Promise<boolean> {
  return stripeConfigured() && (await isFeatureEnabled(db(), 'payments', env().APP_ENV));
}

/** Real (non-test) requests need both release flags: production signing and payments. */
export async function liveSendingEnabled(): Promise<boolean> {
  const appEnv = env().APP_ENV;
  const [signing, payments] = await Promise.all([
    isFeatureEnabled(db(), 'production_signing', appEnv),
    paymentsAvailable(),
  ]);
  return signing && payments;
}

export function appUrl(path: string): string {
  return new URL(path, env().BETTER_AUTH_URL).toString();
}
