'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import {
  AppError,
  renewNotificationLink,
  resolveNotificationLink,
  startRetrieval,
  verifyRetrieval,
} from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { requestMeta } from '@/lib/session';
import { RETRIEVE_COOKIE, RETRIEVE_MAX_AGE } from '@/lib/retrieve-session';
import { sendRetrievalCode } from '@/lib/signing-mail';
import { dispatchAfterResponse, type LinkTarget } from '@/lib/notifications';
import { destinationFor } from './destination';

export type LinkState =
  | { step: 'start'; message?: string; error?: boolean }
  | { step: 'code'; sessionId: string; message?: string; error?: boolean }
  | { step: 'renewed'; destination: string; message: string }
  | null;

function errorText(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof ZodError) return err.issues[0]?.message ?? 'Check what you entered.';
  throw err;
}

/**
 * Verifies that the person following an emailed link controls the address it was sent to: a
 * one-time code goes to that address (never one typed on this page), then a 30-minute retrieval
 * session opens the document. A forwarded link alone cannot get past this step.
 */
export async function linkAction(
  token: string,
  to: LinkTarget,
  prev: LinkState,
  fd: FormData,
): Promise<LinkState> {
  const link = await resolveNotificationLink(db(), token);
  if (!link || link.audience !== 'recipient' || link.revoked)
    return { step: 'start', message: 'This link no longer works.', error: true };

  if (fd.get('intent') !== 'verify' || prev?.step !== 'code') {
    try {
      const r = await startRetrieval(db(), link.email, await requestMeta());
      if (r.code) await sendRetrievalCode(r.email, r.code);
      return {
        step: 'code',
        sessionId: r.sessionId,
        message:
          'We emailed a 6-digit code to the address this document was sent to. It expires in 10 minutes.',
      };
    } catch (err) {
      return { step: 'start', message: errorText(err), error: true };
    }
  }

  let sessionToken: string;
  try {
    sessionToken = await verifyRetrieval(
      db(),
      prev.sessionId,
      link.email,
      String(fd.get('code') ?? ''),
    );
  } catch (err) {
    return { ...prev, message: errorText(err), error: true };
  }
  (await cookies()).set(RETRIEVE_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().APP_ENV === 'production' || env().APP_ENV === 'staging',
    path: '/',
    maxAge: RETRIEVE_MAX_AGE,
  });
  const destination = destinationFor(link.requestId, to);
  if (link.expired) {
    // Identity is verified: issue a fresh link by email, and let them continue right away.
    try {
      await renewNotificationLink(db(), sessionToken, token);
      dispatchAfterResponse(link.requestId);
    } catch (err) {
      return { step: 'start', message: errorText(err), error: true };
    }
    return {
      step: 'renewed',
      destination,
      message: 'A new secure link is on its way to your inbox. Older links no longer work.',
    };
  }
  redirect(destination);
}
