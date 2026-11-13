import 'server-only';
import { createPrivateKey, sign } from 'node:crypto';
import { env } from './env';

export type SocialProviderId = 'google' | 'apple';

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/**
 * Apple's client secret is a short-lived ES256 JWT signed with the Sign in with Apple key (.p8).
 * Generating it here, instead of storing a pasted JWT, means it never silently expires (Apple caps
 * a secret at six months).
 */
export function appleClientSecret(opts: {
  teamId: string;
  keyId: string;
  clientId: string;
  privateKey: string;
  now?: number;
}): string {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: opts.keyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: opts.teamId,
      iat,
      exp: iat + 60 * 60 * 24 * 150,
      aud: 'https://appleid.apple.com',
      sub: opts.clientId,
    }),
  );
  // Vercel stores multi-line values fine, but a pasted key often arrives with literal "\n".
  const pem = opts.privateKey.includes('\\n') ? opts.privateKey.replace(/\\n/g, '\n') : opts.privateKey;
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(pem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Better Auth socialProviders config, containing only the providers whose credentials are set. */
export function socialProvidersConfig() {
  const e = env();
  const out: {
    google?: { clientId: string; clientSecret: string; prompt: 'select_account' };
    apple?: { clientId: string; clientSecret: string };
  } = {};
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) {
    out.google = {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      prompt: 'select_account',
    };
  }
  if (e.APPLE_CLIENT_ID && e.APPLE_TEAM_ID && e.APPLE_KEY_ID && e.APPLE_PRIVATE_KEY) {
    try {
      out.apple = {
        clientId: e.APPLE_CLIENT_ID,
        clientSecret: appleClientSecret({
          teamId: e.APPLE_TEAM_ID,
          keyId: e.APPLE_KEY_ID,
          clientId: e.APPLE_CLIENT_ID,
          privateKey: e.APPLE_PRIVATE_KEY,
        }),
      };
    } catch (err) {
      // A malformed key must not take down email sign-in; Apple is simply left out.
      console.error('Sign in with Apple disabled: APPLE_PRIVATE_KEY could not be read', err);
    }
  }
  return out;
}

/** Providers to show buttons for. */
export function enabledSocialProviders(): SocialProviderId[] {
  return Object.keys(socialProvidersConfig()) as SocialProviderId[];
}
