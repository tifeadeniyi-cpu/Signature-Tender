import 'server-only';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('Signature Tender <no-reply@example.com>'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DEV_MAIL_DIR: z.string().optional(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  // Some S3-compatible stores (for example Neon object storage) only accept path-style URLs.
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Stripe, test mode only in this phase. Leave empty to keep payments unavailable.
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  // Development and test only: point the Stripe client at a local stand-in (used by e2e tests).
  STRIPE_API_HOST: z.string().optional(),
  STRIPE_API_PORT: z.coerce.number().optional(),
  STRIPE_API_PROTOCOL: z.enum(['http', 'https']).optional(),
  // Encrypts webhook signing secrets at rest. Falls back to BETTER_AUTH_SECRET outside production;
  // required when APP_ENV is production (webhooks refuse to run without it).
  WEBHOOK_SECRETS_KEY: z.string().min(32).optional(),
  // Vercel Cron sends it as a bearer token to /api/cron/*. Without it, cron routes refuse to run.
  CRON_SECRET: z.string().min(16).optional(),
});

let cached: z.infer<typeof schema> | undefined;
export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
