import 'server-only';
import { buildCompletionPackage } from '@st/core';

export type CompletionKind = 'package' | 'signed' | 'certificate';

/** `?kind=package|signed|certificate`. Without one, the signed agreement (the in-page viewer's file). */
export function completionKind(v: string | null): CompletionKind {
  return v === 'package' || v === 'certificate' ? v : 'signed';
}

/**
 * Reads one completed file through the caller's own (permission-checked) reader. The complete
 * package is the signed agreement followed by the Certificate of Completion, assembled from the
 * two stored, integrity-checked files; it matches the package hash recorded at completion.
 */
export async function readCompletion(
  kind: CompletionKind,
  read: (k: 'signed' | 'certificate') => Promise<{ bytes: Uint8Array; filename: string | null }>,
): Promise<{ bytes: Uint8Array; filename: string }> {
  if (kind !== 'package') {
    const r = await read(kind);
    return { bytes: r.bytes, filename: r.filename ?? `${kind}.pdf` };
  }
  const signed = await read('signed');
  const cert = await read('certificate');
  const base = (signed.filename ?? 'document.pdf')
    .replace(/\.pdf$/i, '')
    .replace(/ \(signed\)$/, '');
  return {
    bytes: await buildCompletionPackage(signed.bytes, cert.bytes),
    filename: `${base} (signed, with certificate).pdf`,
  };
}
