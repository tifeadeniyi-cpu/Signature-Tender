import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor, haveIBeenPwned } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { expo } from '@better-auth/expo';
import { schema } from '@st/db';
import { db } from './db';
import { env } from './env';
import { socialProvidersConfig } from './social-providers';
import { sendEmail } from './email';
import { emailConfig } from './email/config';
import { renderPasswordReset, renderVerifyEmail } from './email/templates/transactional';

/** The iOS and Android app's URL scheme (apps/mobile app.json). */
export const MOBILE_APP_ORIGIN = 'signaturetender://';

function build() {
  const e = env();
  const url = new URL(e.BETTER_AUTH_URL);
  const isProd = e.APP_ENV === 'production' || e.APP_ENV === 'staging';
  const socialProviders = socialProvidersConfig();
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
        const r = renderPasswordReset({ config: await emailConfig(), url: link });
        await sendEmail({
          to: user.email,
          subject: r.subject,
          text: r.text,
          html: r.html,
          attachments: r.attachments,
          tags: [{ name: 'template', value: 'password_reset' }],
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url: link }) => {
        const r = renderVerifyEmail({ config: await emailConfig(), name: user.name, url: link });
        await sendEmail({
          to: user.email,
          subject: r.subject,
          text: r.text,
          html: r.html,
          attachments: r.attachments,
          tags: [{ name: 'template', value: 'verify_email' }],
        });
      },
    },
    socialProviders,
    // Apple returns to the callback with a cross-site form POST. The mobile app identifies itself
    // with its URL scheme (sent as the expo-origin header by the Expo client).
    trustedOrigins: [
      MOBILE_APP_ORIGIN,
      ...(socialProviders.apple ? ['https://appleid.apple.com'] : []),
    ],
    account: {
      accountLinking: {
        enabled: true,
        // Google and Apple verify the address, so signing in with them joins an existing
        // account for the same email instead of failing.
        trustedProviders: ['google', 'apple'],
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
        '/sign-in/social': { window: 60, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: isProd,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
    plugins: [
      // Lets the iOS and Android app sign in: its cookies travel in a header, not a browser jar.
      expo(),
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
