import 'server-only';
import { cookies } from 'next/headers';
import { hashSecret } from '@st/core';

/** One httpOnly cookie per recipient link holds that recipient's signing-session secret. */
export const signCookieName = (token: string) => `sts_${hashSecret(token).slice(0, 16)}`;

export async function readSignSession(token: string) {
  return (await cookies()).get(signCookieName(token))?.value;
}
