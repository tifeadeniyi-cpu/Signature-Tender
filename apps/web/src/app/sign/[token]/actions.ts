'use server';
import { kickWebhooks } from '@/lib/webhooks';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  getSignerView,
  startSigning,
  verifySigningCode,
  giveConsent,
  adoptSignature,
  saveSigningProgress,
  completeSigning,
  finalizeRequest,
  declineSigning,
  AppError,
} from '@st/core';
import { ZodError } from 'zod';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { env } from '@/lib/env';
import { dispatchAfterResponse } from '@/lib/notifications';
import { getSession, requestMeta } from '@/lib/session';
import { purchasedDesignPng } from '@st/core/studio/server';
import { studioDeps, studioSettings } from '@/lib/studio';
import { signCookieName, readSignSession } from '@/lib/sign-session';
import {
  sendInvitations,
  sendSigningCode,
  sendSenderNotice,
  type RequestContext,
} from '@/lib/signing-mail';

export type SignResult = { ok: boolean; message?: string } | null;

const readSession = readSignSession;
async function writeSession(token: string, value: string | null) {
  const jar = await cookies();
  const name = signCookieName(token);
  if (!value) return jar.delete(name);
  jar.set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().APP_ENV === 'production' || env().APP_ENV === 'staging',
    path: '/',
    maxAge: 12 * 3600,
  });
}

function fail(err: unknown): { ok: false; message: string } {
  if (err instanceof AppError) return { ok: false, message: err.message };
  if (err instanceof ZodError)
    return { ok: false, message: err.issues[0]?.message ?? 'Please check your entries.' };
  console.error(err);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

async function context(token: string): Promise<RequestContext> {
  const v = await getSignerView(db(), token, undefined);
  return {
    title: v.title,
    senderName: v.senderName,
    workspaceName: v.workspaceName,
    message: v.emailMessage,
    isTest: v.isTest,
    workspaceId: v.workspaceId,
  };
}

export async function startAction(token: string): Promise<SignResult> {
  kickWebhooks();
  try {
    const res = await startSigning(db(), token, await requestMeta());
    if ('session' in res) await writeSession(token, res.session);
    else await sendSigningCode(res.email, res.name, res.code, await context(token));
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/sign/${token}`);
  return { ok: true };
}

export async function verifyCodeAction(
  token: string,
  _prev: SignResult,
  fd: FormData,
): Promise<SignResult> {
  kickWebhooks();
  try {
    const { session } = await verifySigningCode(
      db(),
      token,
      String(fd.get('code') ?? ''),
      await requestMeta(),
    );
    await writeSession(token, session);
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/sign/${token}`);
  return { ok: true };
}

export async function consentAction(
  token: string,
  _prev: SignResult,
  fd: FormData,
): Promise<SignResult> {
  kickWebhooks();
  try {
    await giveConsent(
      db(),
      token,
      await readSession(token),
      { disclosureVersion: String(fd.get('version') ?? ''), agree: fd.get('agree') === 'on' },
      await requestMeta(),
    );
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/sign/${token}`);
  return { ok: true };
}

export async function adoptAction(
  token: string,
  input: Parameters<typeof adoptSignature>[3],
): Promise<
  { ok: true; id: string; dataUrl: string; applied: string[] } | { ok: false; message: string }
> {
  try {
    const r = await adoptSignature(
      db(),
      token,
      await readSession(token),
      input,
      await requestMeta(),
    );
    return { ok: true, ...r };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Adopts one of the signer's purchased Signature Studio designs. Only when they are signed in
 * with a verified email that matches this recipient; the design is checked against their
 * entitlement on the server. It then goes through the normal adoption (consent, this signing
 * session, audit trail) and costs nothing extra.
 */
export async function adoptStudioDesignAction(
  token: string,
  input: { kind: 'signature' | 'initials'; designId: string; applyTo?: string[] },
): Promise<
  { ok: true; id: string; dataUrl: string; applied: string[] } | { ok: false; message: string }
> {
  try {
    const session = await getSession();
    const user = session?.user.emailVerified ? session.user : null;
    if (!user) return { ok: false, message: 'Sign in to use a signature from your library.' };
    const signSession = await readSession(token);
    const view = await getSignerView(db(), token, signSession);
    if (view.recipient.email.toLowerCase() !== user.email.toLowerCase())
      return {
        ok: false,
        message: 'Your saved signatures can only be used on documents sent to your own email address.',
      };
    const png = await purchasedDesignPng(
      db(),
      studioDeps(),
      user.id,
      input.designId,
      input.kind,
      await studioSettings(),
    );
    const r = await adoptSignature(
      db(),
      token,
      signSession,
      { kind: input.kind, method: 'uploaded', pngBase64: png.toString('base64'), applyTo: input.applyTo },
      await requestMeta(),
      { kind: 'signature_studio', designId: input.designId },
    );
    return { ok: true, ...r };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Saves drafts (and, for Save & Exit, ends this browser session). Nothing is signed here.
 */
export async function saveProgressAction(
  token: string,
  input: Parameters<typeof saveSigningProgress>[3],
): Promise<{ ok: true; savedAt: string } | { ok: false; message: string; ended?: boolean }> {
  try {
    const r = await saveSigningProgress(
      db(),
      token,
      await readSession(token),
      input,
      await requestMeta(),
    );
    // On exit the session is revoked in the database (its hash is cleared), so the cookie is
    // already worthless. It is left in place on purpose: changing cookies in a server action
    // re-renders the route, which would replace the "progress saved" confirmation.
    return { ok: true, savedAt: r.savedAt.toISOString() };
  } catch (err) {
    const f = fail(err);
    return { ...f, ended: err instanceof AppError && err.code === 'unauthenticated' };
  }
}

export async function completeAction(
  token: string,
  input: Parameters<typeof completeSigning>[4],
): Promise<SignResult> {
  kickWebhooks();
  const meta = await requestMeta();
  let ctx: RequestContext;
  let result: Awaited<ReturnType<typeof completeSigning>>;
  try {
    ctx = await context(token);
    result = await completeSigning(db(), storage(), token, await readSession(token), input, meta);
  } catch (err) {
    // A repeated submission (double click, retry after a lost response) is not an error if the
    // first one was recorded: the server refuses to sign twice, and the page shows the result.
    if (err instanceof AppError && err.code === 'conflict') {
      const v = await getSignerView(db(), token, undefined).catch(() => null);
      if (v && (v.stage === 'signed_waiting' || v.stage === 'completed')) {
        revalidatePath(`/sign/${token}`);
        return { ok: true };
      }
    }
    return fail(err);
  }
  // The session cookie stays until it expires so the completed document opens without a new code.
  try {
    await sendInvitations(result.invitations, ctx);
    if (result.readyToFinalize) {
      // Finalizing queues the completion emails (sender and every recipient) in the same
      // transaction; they are sent after this response so signing never waits on email.
      await finalizeRequest(db(), storage(), { token }, result.requestId);
      dispatchAfterResponse(result.requestId);
    }
  } catch (err) {
    // Your signature is already committed; delivery or finalization problems are recorded separately.
    console.error(err);
  }
  revalidatePath(`/sign/${token}`);
  return { ok: true };
}

export async function declineAction(
  token: string,
  _prev: SignResult,
  fd: FormData,
): Promise<SignResult> {
  kickWebhooks();
  try {
    const ctx = await context(token);
    const r = await declineSigning(
      db(),
      token,
      await readSession(token),
      String(fd.get('reason') ?? ''),
      await requestMeta(),
    );
    await writeSession(token, null);
    await sendSenderNotice(r.senderEmail, 'declined', {
      ...ctx,
      documentId: r.documentId,
      recipientName: r.recipientName,
      reason: r.reason,
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath(`/sign/${token}`);
  return { ok: true };
}
