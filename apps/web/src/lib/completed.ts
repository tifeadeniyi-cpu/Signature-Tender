import 'server-only';
import { cookies } from 'next/headers';
import { getConfigValue } from '@st/core';
import { db } from './db';
import { env } from './env';

/** Short-lived, httpOnly: lets the sign-up form prefill the recipient's verified address. */
export const CLAIM_EMAIL_COOKIE = 'st_claim_email';
const CLAIM_EMAIL_MAX_AGE = 30 * 60;

export function claimSecret() {
  return env().BETTER_AUTH_SECRET;
}

export async function setClaimEmail(email: string) {
  (await cookies()).set(CLAIM_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().APP_ENV === 'production' || env().APP_ENV === 'staging',
    path: '/',
    maxAge: CLAIM_EMAIL_MAX_AGE,
  });
}

export async function readClaimEmail(): Promise<string | null> {
  const v = (await cookies()).get(CLAIM_EMAIL_COOKIE)?.value ?? '';
  return /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(v) ? v : null;
}

export async function supportEmail() {
  return getConfigValue(db(), 'support.email', 'support@signaturetender.com');
}

export function displayTimeZone() {
  return env().EMAIL_TIMEZONE;
}
