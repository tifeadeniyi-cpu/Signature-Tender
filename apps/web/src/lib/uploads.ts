import 'server-only';
import { createHash } from 'node:crypto';
import { AppError } from '@st/core';
import { storage } from './storage';
import { UPLOAD_PART_BYTES } from './upload-limits';

/**
 * Large uploads arrive in pieces (see UPLOAD_PART_BYTES), each stored as a temporary private
 * object under the uploader's own prefix, then joined, checked and saved like any upload. The
 * pieces are deleted as soon as they are joined.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function owner(userId: string) {
  return createHash('sha256').update(`st:upload:${userId}`).digest('hex').slice(0, 32);
}

function partKey(userId: string, uploadId: string, part: number) {
  return `tmp/uploads/${owner(userId)}/${uploadId.toLowerCase()}/${part}`;
}

export function maxParts(maxMb: number) {
  return Math.ceil(((maxMb + 1) * 1024 * 1024) / UPLOAD_PART_BYTES);
}

/** Stores one piece. Sending the same piece again (a retry) replaces it. */
export async function putUploadPart(
  userId: string,
  uploadId: string,
  part: number,
  bytes: Uint8Array,
  maxMb: number,
) {
  if (!UUID.test(uploadId)) throw new AppError('invalid', 'Invalid upload.');
  if (!Number.isInteger(part) || part < 0 || part >= maxParts(maxMb))
    throw new AppError('invalid', `The file is larger than ${maxMb} MB.`);
  if (!bytes.length || bytes.length > UPLOAD_PART_BYTES)
    throw new AppError('invalid', 'Invalid upload piece.');
  const key = partKey(userId, uploadId, part);
  await storage()
    .delete(key)
    .catch(() => undefined);
  await storage().put(key, bytes, 'application/octet-stream');
}

async function deleteParts(userId: string, uploadId: string, parts: number) {
  await Promise.all(
    Array.from({ length: parts }, (_, i) =>
      storage()
        .delete(partKey(userId, uploadId, i))
        .catch(() => undefined),
    ),
  );
}

/** Joins the pieces of an upload, then deletes them. */
async function joinParts(userId: string, uploadId: string, parts: number, maxMb: number) {
  if (!UUID.test(uploadId)) throw new AppError('invalid', 'Invalid upload.');
  if (!Number.isInteger(parts) || parts < 1 || parts > maxParts(maxMb))
    throw new AppError('invalid', `The file is larger than ${maxMb} MB.`);
  try {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < parts; i++) {
      const c = await storage()
        .get(partKey(userId, uploadId, i))
        .catch(() => null);
      if (!c) throw new AppError('invalid', 'The upload did not finish. Please try again.');
      chunks.push(c);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (total > maxMb * 1024 * 1024)
      throw new AppError('invalid', `The file is larger than ${maxMb} MB.`);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  } finally {
    await deleteParts(userId, uploadId, parts);
  }
}

export interface ReceivedUpload {
  filename: string;
  bytes: Uint8Array;
  field: (name: string) => string | null;
}

/**
 * Reads an upload request either way it can arrive: multipart with the file (small files), or
 * JSON naming an upload sent in pieces ({ uploadId, parts, filename, ...fields }).
 */
export async function receiveUpload(
  req: Request,
  userId: string,
  maxMb: number,
): Promise<ReceivedUpload> {
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new AppError('invalid', 'Invalid upload.');
    const bytes = await joinParts(userId, String(body.uploadId ?? ''), Number(body.parts), maxMb);
    return {
      filename: String(body.filename ?? 'document.pdf').slice(0, 255),
      bytes,
      field: (name) =>
        body[name] === undefined || body[name] === null ? null : String(body[name]),
    };
  }
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > (maxMb + 1) * 1024 * 1024)
    throw new AppError('invalid', `The file is larger than ${maxMb} MB.`);
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('invalid', 'Choose a PDF to upload.');
  return {
    filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    field: (name) => {
      const v = form.get(name);
      return typeof v === 'string' ? v : null;
    },
  };
}
