import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { getTemplate, AppError } from '@st/core';
import { db } from './db';
import { requireWorkspace } from './session';

/** Loads a template for its pages. Missing or inaccessible templates render a 404. */
export const loadTemplatePage = cache(async (id: string) => {
  const ctx = await requireWorkspace();
  try {
    const data = await getTemplate(db(), { userId: ctx.user.id }, id);
    /** What the editor shows: the unpublished draft if there is one, otherwise the published version. */
    const working = data.draft ?? data.published!;
    return { ...ctx, ...data, working };
  } catch (err) {
    if (err instanceof AppError && (err.code === 'not_found' || err.code === 'forbidden'))
      notFound();
    throw err;
  }
});
