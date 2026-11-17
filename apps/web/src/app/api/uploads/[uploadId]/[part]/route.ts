import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { AppError, getConfigValue } from '@st/core';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError } from '@/lib/api';
import { putUploadPart } from '@/lib/uploads';
import { UPLOAD_PART_BYTES } from '@/lib/upload-limits';

export const dynamic = 'force-dynamic';

/** One piece of a large upload (raw bytes). Signed-in, verified people only; pieces are private. */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ uploadId: string; part: string }> },
) {
  try {
    const session = await auth().api.getSession({ headers: await headers() });
    if (!session || !session.user.emailVerified)
      throw new AppError('unauthenticated', 'Sign in to upload documents');
    const { uploadId, part } = await params;
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > UPLOAD_PART_BYTES) throw new AppError('invalid', 'Invalid upload piece.');
    const maxMb = await getConfigValue(db(), 'limits.max_upload_mb', 25);
    const bytes = new Uint8Array(await req.arrayBuffer());
    await putUploadPart(session.user.id, uploadId, Number(part), bytes, maxMb);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return apiError(err);
  }
}
