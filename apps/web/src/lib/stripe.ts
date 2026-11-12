import 'server-only';
import Stripe from 'stripe';
import { env } from './env';

/**
 * Stripe client. Runs in whichever mode the secret key belongs to: an sk_test_ key means test mode,
 * an sk_live_ (or rk_live_) key means real payments. Webhook events from the other mode are ignored.
 */
let client: Stripe | null | undefined;

export function stripeConfigured(): boolean {
  const e = env();
  return Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET);
}

/** True when the configured key is a live key, so real money moves. */
export function stripeLiveMode(): boolean {
  return /^(sk|rk)_live_/.test(env().STRIPE_SECRET_KEY);
}

export function stripe(): Stripe {
  if (client) return client;
  const e = env();
  const key = e.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  const local = e.APP_ENV === 'development' || e.APP_ENV === 'test';
  client = new Stripe(key, {
    appInfo: { name: 'Signature Tender' },
    maxNetworkRetries: 2,
    ...(local && e.STRIPE_API_HOST
      ? {
          host: e.STRIPE_API_HOST,
          port: e.STRIPE_API_PORT,
          protocol: e.STRIPE_API_PROTOCOL ?? 'http',
        }
      : {}),
  });
  return client;
}

export function webhookSecret(): string {
  const s = env().STRIPE_WEBHOOK_SECRET;
  if (!s) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  return s;
}
