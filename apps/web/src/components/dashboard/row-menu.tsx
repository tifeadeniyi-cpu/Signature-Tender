'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Eye, PanelRight, PencilLine, Download, Award } from 'lucide-react';
import { ArchiveButton } from '@/components/documents/library-buttons';

export interface RowMenuDoc {
  id: string;
  title: string;
  bucket: string;
  requestId: string | null;
  canDownload: boolean;
  canEdit: boolean;
}

const item =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-dark-text hover:bg-cream focus-visible:bg-cream focus-visible:outline-none';

/**
 * Per-row actions. Only actions this document's state allows are listed; the server checks
 * permissions again on every one of them (download, archive, editing).
 */
export function RowMenu({ doc }: { doc: RowMenuDoc }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const completed = doc.bucket === 'completed';
  const archivable = [
    'completed',
    'declined',
    'expired',
    'cancelled',
    'drafts',
    'archived',
  ].includes(doc.bucket);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${doc.title}`}
        className="flex size-8 items-center justify-center rounded-lg text-primary hover:bg-cream focus-visible:outline-2 focus-visible:outline-gold"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-border bg-white p-1.5 shadow-card"
        >
          <a
            href={`/app/documents/${doc.id}`}
            data-drawer-open={doc.id}
            role="menuitem"
            className={item}
            onClick={() => setOpen(false)}
          >
            <PanelRight className="size-4" aria-hidden /> View details
          </a>
          <Link href={`/app/documents/${doc.id}`} role="menuitem" className={item}>
            <Eye className="size-4" aria-hidden /> Open document
          </Link>
          {doc.bucket === 'drafts' && doc.canEdit ? (
            <Link href={`/app/documents/${doc.id}/prepare`} role="menuitem" className={item}>
              <PencilLine className="size-4" aria-hidden /> Continue editing
            </Link>
          ) : null}
          {doc.canDownload && doc.requestId ? (
            <a
              href={`/api/requests/${doc.requestId}/file?kind=package`}
              role="menuitem"
              className={item}
            >
              <Download className="size-4" aria-hidden /> Download
            </a>
          ) : null}
          {completed && doc.canDownload && doc.requestId ? (
            <a
              href={`/api/requests/${doc.requestId}/file?kind=certificate`}
              role="menuitem"
              className={item}
            >
              <Award className="size-4" aria-hidden /> View certificate
            </a>
          ) : null}
          {archivable ? (
            <div
              role="none"
              className="mt-1 border-t border-border pt-1 [&_button]:w-full [&_button]:justify-start"
            >
              <ArchiveButton
                documentId={doc.id}
                archived={doc.bucket === 'archived'}
                title={doc.title}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
