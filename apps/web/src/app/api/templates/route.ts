import { NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { createTemplateFromUpload, getConfigValue, listMyWorkspaces, AppError } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { receiveUpload } from '@/lib/uploads';
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
    // Small files arrive in one request; larger ones in pieces (see lib/uploads).
    const upload = await receiveUpload(req, session.user.id, maxMb);
    const { id } = await createTemplateFromUpload(
      db(),
      storage(),
      actor,
      {
        workspaceId: ws.id,
        title: upload.field('title') ?? '',
        description: upload.field('description') ?? '',
        category: upload.field('category') ?? '',
        documentType: upload.field('documentType') ?? '',
        shared: upload.field('shared') !== 'false',
        filename: upload.filename,
        bytes: upload.bytes,
      },
      { maxBytes: maxMb * 1024 * 1024, maxPages },
      await requestMeta(),
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
