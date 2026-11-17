import { NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import {
  createDocumentFromUpload,
  getConfigValue,
  listMyWorkspaces,
  saveRecipients,
  AppError,
} from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { storage } from '@/lib/storage';
import { apiError } from '@/lib/api';
import { receiveUpload } from '@/lib/uploads';
import { requestMeta, WORKSPACE_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Upload: file (PDF), title, documentType, and selfSign=1 for "Sign it yourself". Multipart for
 * small files, or JSON naming an upload sent in pieces for files over the hosting body limit.
 * Creates a draft document in the current workspace.
 */
export async function POST(req: Request) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to upload documents');
    const actor = { userId: session.user.id };
    const workspaces = await listMyWorkspaces(db(), actor);
    const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    const ws = workspaces.find((w) => w.id === preferred) ?? workspaces[0];
    if (!ws) throw new AppError('forbidden', 'Create a workspace first');

    const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
    const maxPages = await getConfigValue(db(), 'limits.max_pages', 200);
    // Small files arrive in one request; larger ones in pieces (see lib/uploads).
    const upload = await receiveUpload(req, session.user.id, maxMb);
    const { id } = await createDocumentFromUpload(
      db(),
      storage(),
      actor,
      {
        workspaceId: ws.id,
        title: upload.field('title') ?? '',
        documentType: upload.field('documentType') ?? '',
        filename: upload.filename,
        bytes: upload.bytes,
      },
      { maxBytes: maxMb * 1024 * 1024, maxPages },
      await requestMeta(),
    );
    // Sign it yourself: you are the only signer, so the signers step is skipped.
    if (upload.field('selfSign') === '1')
      await saveRecipients(
        db(),
        actor,
        id,
        {
          signingOrderEnabled: false,
          recipients: [
            {
              name: session.user.name || session.user.email,
              email: session.user.email,
              role: 'signer',
              signingOrder: 1,
              authMethod: 'email_link',
            },
          ],
        },
        { maxSigners: 5 },
        await requestMeta(),
      );
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return apiError(err);
  }
}
