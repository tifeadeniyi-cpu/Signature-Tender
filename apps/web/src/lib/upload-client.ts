import { UPLOAD_PART_BYTES } from './upload-limits';

/**
 * Sends a PDF and its form fields to an upload endpoint. Small files go in one request as
 * before; larger ones go in pieces under the hosting limit, then the endpoint joins them.
 * `onProgress` gets 0..1 while pieces are sent.
 */
export async function sendUpload(
  endpoint: string,
  file: File,
  fields: Record<string, string>,
  onProgress?: (fraction: number) => void,
): Promise<Response> {
  if (file.size <= UPLOAD_PART_BYTES) {
    const fd = new FormData();
    fd.set('file', file);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fetch(endpoint, { method: 'POST', body: fd });
  }
  const uploadId = crypto.randomUUID();
  const parts = Math.ceil(file.size / UPLOAD_PART_BYTES);
  for (let i = 0; i < parts; i++) {
    const piece = file.slice(i * UPLOAD_PART_BYTES, (i + 1) * UPLOAD_PART_BYTES);
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`/api/uploads/${uploadId}/${i}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: piece,
      }).catch(() => null);
      if (res?.ok) break;
      if (res && res.status < 500) break; // a refusal, not a hiccup: do not retry
    }
    if (!res?.ok)
      return (
        res ??
        new Response(
          JSON.stringify({ error: 'Upload failed. Check your connection and try again.' }),
          { status: 502 },
        )
      );
    onProgress?.((i + 1) / parts);
  }
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...fields, uploadId, parts, filename: file.name }),
  });
}
