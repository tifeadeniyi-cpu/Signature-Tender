import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor, haveIBeenPwned } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { schema } from '@st/db';
import { db } from './db';
import { env } from './env';
import { sendEmail, brandedEmail } from './email';

function build() {
  const e = env();
  const url = new URL(e.BETTER_AUTH_URL);
  const isProd = e.APP_ENV === 'production' || e.APP_ENV === 'staging';
  return betterAuth({
    appName: 'Signature Tender',
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    telemetry: { enabled: false },
    database: drizzleAdapter(db(), {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
        passkey: schema.passkey,
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url: link }) => {
        await sendEmail({
          to: user.email,
          subject: 'Reset your Signature Tender password',
          ...brandedEmail({
            heading: 'Reset your password',
            body: 'We received a request to reset your password. This link expires in 1 hour. If you did not ask for this, you can ignore this email.',
            actionLabel: 'Choose a new password',
            actionUrl: link,
          }),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url: link }) => {
        await sendEmail({
          to: user.email,
          subject: 'Verify your email for Signature Tender',
          ...brandedEmail({
            heading: 'Confirm your email address',
            body: `Hi ${user.name}, confirm this email address to finish creating your Signature Tender account. The link expires in 24 hours.`,
            actionLabel: 'Verify email',
            actionUrl: link,
          }),
        });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 60 * 15 },
    rateLimit: {
      enabled: e.APP_ENV !== 'test',
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: isProd,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
    plugins: [
      twoFactor({ issuer: 'Signature Tender' }),
      passkey({ rpID: url.hostname, rpName: 'Signature Tender', origin: url.origin }),
      // Breached-password check uses k-anonymity (only a hash prefix leaves the server). Enabled outside local dev.
      ...(isProd ? [haveIBeenPwned()] : []),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __stAuth?: Auth };
export function auth(): Auth {
  g.__stAuth ??= build();
  return g.__stAuth;
}
