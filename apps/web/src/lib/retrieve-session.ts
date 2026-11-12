import 'server-only';
import { cookies } from 'next/headers';

/** Cookie for a verified-email retrieval session. The database keeps only its hash. */
export const RETRIEVE_COOKIE = 'st_retrieve';
export const RETRIEVE_MAX_AGE = 30 * 60;

export async function readRetrieveSession(): Promise<string | undefined> {
  return (await cookies()).get(RETRIEVE_COOKIE)?.value;
}
