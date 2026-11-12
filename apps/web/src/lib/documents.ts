import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { getDocument, getRequestsForDocument, AppError } from '@st/core';
import { db } from './db';
import { requireWorkspace } from './session';

/** Loads a document for the preparation wizard. Missing or inaccessible documents render a 404. */
export async function loadPreparation(id: string) {
  const ctx = await requireWorkspace();
  try {
    const data = await getDocument(db(), { userId: ctx.user.id }, id);
    const [latest] = await getRequestsForDocument(db(), { userId: ctx.user.id }, id);
    if (latest && !['declined', 'expired', 'cancelled'].includes(latest.request.status)) {
      redirect(`/app/documents/${id}`);
    }
    return { ...ctx, ...data, previousRequest: latest ?? null };
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') notFound();
    throw err;
  }
}
