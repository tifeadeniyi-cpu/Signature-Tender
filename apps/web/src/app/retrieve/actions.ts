'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { AppError, reissueSigningLink, startRetrieval, verifyRetrieval } from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { requestMeta } from '@/lib/session';
import { RETRIEVE_COOKIE, RETRIEVE_MAX_AGE, readRetrieveSession } from '@/lib/retrieve-session';
import { sendInvitations, sendRetrievalCode } from '@/lib/signing-mail';

export type RetrieveState =
  | { step: 'email'; message?: string; error?: boolean }
  | { step: 'code'; sessionId: string; email: string; message?: string; error?: boolean }
  | null;

function errorText(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof ZodError) return err.issues[0]?.message ?? 'Check what you entered.';
  throw err;
}

/** Step 1. The reply is the same whether or not we have documents for the address. */
export async function requestCodeAction(
  _prev: RetrieveState,
  fd: FormData,
): Promise<RetrieveState> {
  const raw = String(fd.get('email') ?? '');
  try {
    const r = await startRetrieval(db(), raw, await requestMeta());
    if (r.code) await sendRetrievalCode(r.email, r.code);
    return {
      step: 'code',
      sessionId: r.sessionId,
      email: r.email,
      message: `If any documents were sent to ${r.email}, we have emailed a 6-digit code. It expires in 10 minutes.`,
    };
  } catch (err) {
    return { step: 'email', message: errorText(err), error: true };
  }
}

/** Step 2. A correct code starts a 30-minute session in this browser. */
export async function verifyCodeAction(prev: RetrieveState, fd: FormData): Promise<RetrieveState> {
  if (prev?.step !== 'code') return { step: 'email' };
  try {
    const token = await verifyRetrieval(
      db(),
      prev.sessionId,
      prev.email,
      String(fd.get('code') ?? ''),
    );
    (await cookies()).set(RETRIEVE_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().APP_ENV === 'production' || env().APP_ENV === 'staging',
      path: '/',
      maxAge: RETRIEVE_MAX_AGE,
    });
  } catch (err) {
    return { ...prev, message: errorText(err), error: true };
  }
  revalidatePath('/retrieve');
  return null;
}

/** One action for both steps, so the form keeps a single state. */
export async function retrieveAction(prev: RetrieveState, fd: FormData): Promise<RetrieveState> {
  return fd.get('intent') === 'verify' ? verifyCodeAction(prev, fd) : requestCodeAction(prev, fd);
}

export async function endRetrievalAction() {
  (await cookies()).delete(RETRIEVE_COOKIE);
  revalidatePath('/retrieve');
}

/** Emails a fresh signing link to the verified address; the previous link stops working. */
export async function newLinkAction(
  requestId: string,
  _prev: { ok: boolean; message: string } | null,
): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await reissueSigningLink(
      db(),
      await readRetrieveSession(),
      requestId,
      await requestMeta(),
    );
    await sendInvitations([r.invitation], {
      title: r.title,
      senderName: r.senderName,
      workspaceName: r.workspaceName,
      message: null,
      isTest: r.isTest,
    });
    return {
      ok: true,
      message: `A new link is on its way to ${r.invitation.email}. Older links no longer work.`,
    };
  } catch (err) {
    return { ok: false, message: errorText(err) };
  }
}
