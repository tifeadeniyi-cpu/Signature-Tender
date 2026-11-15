'use server';
import { verifyFileHash, type HashMatch } from '@st/core';
import { hitRateLimit } from '@st/core/studio/service';
import { db } from '@/lib/db';
import { requestMeta } from '@/lib/session';

/**
 * Compares a SHA-256 computed in the visitor's browser with the stored files of one reference.
 * The file itself never leaves the visitor's device. Rate-limited per IP address.
 */
export async function checkFileHash(
  ref: string,
  sha256: string,
): Promise<{ match: HashMatch | null; error?: string }> {
  const { ipAddress } = await requestMeta();
  if (!(await hitRateLimit(db(), `verify-hash:${ipAddress ?? 'unknown'}`, 30, 3600)))
    return { match: null, error: 'Too many checks from this connection. Try again in an hour.' };
  const match = await verifyFileHash(db(), ref, sha256);
  if (match === null) return { match: null, error: 'That reference or file could not be checked.' };
  return { match };
}
