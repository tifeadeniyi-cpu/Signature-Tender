import 'server-only';
import { notFound } from 'next/navigation';
import { getDocument, AppError } from '@st/core';
import { db } from './db';
import { requireWorkspace } from './session';

/** Loads a document for the preparation wizard. Missing or inaccessible documents render a 404. */
export async function loadPreparation(id: string) {
  const ctx = await requireWorkspace();
  try {
    const data = await getDocument(db(), { userId: ctx.user.id }, id);
    return { ...ctx, ...data };
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') notFound();
    throw err;
  }
}
