'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  getSignerView,
  startSigning,
  verifySigningCode,
  giveConsent,
  adoptSignature,
  completeSigning,
  finalizeRequest,
  declineSigning,
  AppError,
} from '@st/core';
import { ZodError } from 'zod';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { env } from '@/lib/env';
import { requestMeta } from '@/lib/session';
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
): Promise<{ ok: true; id: string; dataUrl: string } | { ok: false; message: string }> {
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

export async function completeAction(
  token: string,
  input: Parameters<typeof completeSigning>[4],
): Promise<SignResult> {
  const meta = await requestMeta();
  let ctx: RequestContext;
  let result: Awaited<ReturnType<typeof completeSigning>>;
  try {
    ctx = await context(token);
    result = await completeSigning(db(), storage(), token, await readSession(token), input, meta);
  } catch (err) {
    return fail(err);
  }
  await writeSession(token, null);
  try {
    await sendInvitations(result.invitations, ctx);
    if (result.readyToFinalize) {
      const fin = await finalizeRequest(db(), storage(), { token }, result.requestId);
      await sendInvitations(fin.invitations, ctx);
      await sendSenderNotice(fin.senderEmail, 'completed', { ...ctx, documentId: fin.documentId });
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
