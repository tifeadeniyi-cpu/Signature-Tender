import type { LinkTarget } from '@/lib/notifications';

/** Where each email button leads once the recipient is verified. */
export function destinationFor(requestId: string, to: LinkTarget) {
  const base = `/retrieve/documents/${requestId}`;
  return to === 'download'
    ? `${base}?start=download`
    : to === 'evidence'
      ? `${base}?tab=evidence`
      : base;
}
