import 'server-only';
import { NextResponse } from 'next/server';
import { AppError } from '@st/core';
import { getSession } from '@/lib/session';

/**
 * Helpers for the JSON endpoints the iOS and Android app calls. The app signs in with Better
 * Auth's Expo plugin, so the same session as the website arrives as a Cookie header and every
 * permission check is the website's own.
 */
export async function requireApiUser() {
  const session = await getSession();
  if (!session) throw new AppError('unauthenticated', 'Sign in to continue.');
  if (!session.user.emailVerified)
    throw new AppError('unauthenticated', 'Verify your email address to continue.');
  return session.user;
}

/**
 * Changes must be sent as JSON. A cross-site HTML form cannot send that content type, so a page
 * on another site cannot make a signed-in browser cancel or remind anything.
 */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    throw new AppError('invalid', 'Send this request as JSON.');
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new AppError('invalid', 'Send this request as JSON.');
  return body as Record<string, unknown>;
}

export const noStore = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: noStore });
