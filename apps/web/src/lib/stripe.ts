import 'server-only';
import Stripe from 'stripe';
import { env } from './env';

/**
 * Stripe client. This phase runs in Stripe test mode only: live keys are refused outright, and
 * live-mode webhook events are ignored, until payments pass their release review.
 */
let client: Stripe | null | undefined;

export function stripeConfigured(): boolean {
  const e = env();
  return Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET);
}

export function stripe(): Stripe {
  if (client) return client;
  const e = env();
  const key = e.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  if (/^(sk|rk)_live_/.test(key))
    throw new Error('Live Stripe keys are not allowed yet. Use a test mode key (sk_test_...).');
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
