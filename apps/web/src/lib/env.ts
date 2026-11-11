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
});

let cached: z.infer<typeof schema> | undefined;
export function env() {
  cached ??= schema.parse(process.env);
  return cached;
}
