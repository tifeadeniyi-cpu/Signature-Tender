import { NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { createTemplateFromUpload, getConfigValue, listMyWorkspaces, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { requestMeta, WORKSPACE_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Multipart upload: file (PDF), title, description, category, documentType, shared. Creates a draft template. */
export async function POST(req: Request) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to create templates');
    const actor = { userId: session.user.id };
    const workspaces = await listMyWorkspaces(db(), actor);
    const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    const ws = workspaces.find((w) => w.id === preferred) ?? workspaces[0];
    if (!ws) throw new AppError('forbidden', 'Create a workspace first');

    const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
    const maxPages = await getConfigValue(db(), 'limits.max_pages', 200);
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > (maxMb + 1) * 1024 * 1024)
      throw new AppError('invalid', `The file is larger than ${maxMb} MB.`);

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('invalid', 'Choose a PDF to upload.');
    const { id } = await createTemplateFromUpload(
      db(),
      storage(),
      actor,
      {
        workspaceId: ws.id,
        title: String(form.get('title') ?? ''),
        description: String(form.get('description') ?? ''),
        category: String(form.get('category') ?? ''),
        documentType: String(form.get('documentType') ?? ''),
        shared: form.get('shared') !== 'false',
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      { maxBytes: maxMb * 1024 * 1024, maxPages },
      await requestMeta(),
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
