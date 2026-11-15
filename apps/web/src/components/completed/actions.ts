'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import {
  AppError,
  accountExistsForEmail,
  createClaimTicket,
  getCompletedForRetrieval,
  getCompletedForSigner,
  startRetrieval,
  verifyRetrieval,
  type CompletedView,
} from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getSession, requestMeta } from '@/lib/session';
import { readSignSession } from '@/lib/sign-session';
import { RETRIEVE_COOKIE, RETRIEVE_MAX_AGE, readRetrieveSession } from '@/lib/retrieve-session';
import { sendRetrievalCode } from '@/lib/signing-mail';
import { claimSecret, setClaimEmail } from '@/lib/completed';

/** How the visitor reached the completed page. Re-checked on every action. */
export type CompletedSource =
  { kind: 'signer'; token: string } | { kind: 'retrieval'; requestId: string };

async function loadView(source: CompletedSource): Promise<CompletedView> {
  if (source.kind === 'signer') {
    const v = await getCompletedForSigner(
      db(),
      source.token,
      await readSignSession(source.token),
      await readRetrieveSession(),
    );
    if (v.state === 'verify') throw new AppError('unauthenticated', 'Verify your email first.');
    return v;
  }
  return getCompletedForRetrieval(db(), await readRetrieveSession(), source.requestId);
}

function ticketFor(view: CompletedView) {
  if (view.state !== 'completed' || !view.you)
    throw new AppError('conflict', 'This document is not completed yet.');
  return createClaimTicket(
    { requestId: view.request.id, recipientId: view.you.recipientId },
    claimSecret(),
  );
}

/**
 * "Create Free Account": keeps a signed reference to this completed document and opens sign-up,
 * or sign-in when the recipient's address already has an account. The address is prefilled only
 * because this visitor has just proved they control it.
 */
export async function startAccountAction(source: CompletedSource) {
  const view = await loadView(source);
  const ticket = ticketFor(view);
  const email = view.you!.email;
  const next = encodeURIComponent(`/claim/${ticket}`);
  if (email) await setClaimEmail(email);
  if (email && (await accountExistsForEmail(db(), email)))
    redirect(`/sign-in?next=${next}&existing=1`);
  redirect(`/sign-up?next=${next}`);
}

/** Signed-in visitors: add the document to their account (the claim page checks the address). */
export async function saveToAccountAction(source: CompletedSource) {
  if (!(await getSession())) redirect('/sign-in');
  const ticket = ticketFor(await loadView(source));
  redirect(`/claim/${ticket}`);
}

export type VerifyState =
  | { step: 'start'; message?: string; error?: boolean }
  | { step: 'code'; sessionId: string; message?: string; error?: boolean }
  | null;

function errorText(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof ZodError) return err.issues[0]?.message ?? 'Check what you entered.';
  throw err;
}

/**
 * Re-verification for a recipient whose signing session has ended: a one-time code goes to the
 * address the link belongs to (never one typed here), then a 30-minute retrieval session opens
 * the completed document.
 */
export async function verifyRecipientAction(
  token: string,
  prev: VerifyState,
  fd: FormData,
): Promise<VerifyState> {
  let email: string;
  try {
    const v = await getCompletedForSigner(
      db(),
      token,
      await readSignSession(token),
      await readRetrieveSession(),
    );
    if (v.state !== 'verify') redirect(`/sign/completed/${token}`);
    email = v.email;
  } catch (err) {
    return { step: 'start', message: errorText(err), error: true };
  }

  if (fd.get('intent') !== 'verify' || prev?.step !== 'code') {
    try {
      const r = await startRetrieval(db(), email, await requestMeta());
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

  try {
    const sessionToken = await verifyRetrieval(
      db(),
      prev.sessionId,
      email,
      String(fd.get('code') ?? ''),
    );
    (await cookies()).set(RETRIEVE_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().APP_ENV === 'production' || env().APP_ENV === 'staging',
      path: '/',
      maxAge: RETRIEVE_MAX_AGE,
    });
  } catch (err) {
    return { ...prev, message: errorText(err), error: true };
  }
  redirect(`/sign/completed/${token}`);
}
