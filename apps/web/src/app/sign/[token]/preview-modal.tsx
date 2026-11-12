'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, MoveHorizontal } from 'lucide-react';
import { PdfPages } from '@/components/documents/pdf-pages';

const ZOOMS = [60, 80, 100, 125, 150, 200];

/**
 * Read-only view of the document exactly as sent. It never completes a field or records consent;
 * the file route only serves it inside an active, verified signing session.
 */
export function PreviewModal({
  token,
  title,
  pageCount,
}: {
  token: string;
  title: string;
  pageCount: number | null;
}) {
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(1);
  const total = pageCount ?? 0;

  const close = useCallback(() => router.replace(`/sign/${token}`), [router, token]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  // Track which page is in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const pages = el.querySelectorAll<HTMLElement>('[data-pdf-page]');
      const mid = el.getBoundingClientRect().top + el.clientHeight / 3;
      let current = 1;
      pages.forEach((p) => {
        if (p.getBoundingClientRect().top <= mid) current = Number(p.dataset.pdfPage);
      });
      setPage(current);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const goTo = (n: number) => {
    const target = scroller.current?.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const zi = ZOOMS.indexOf(zoom);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${title}`}
      className="fixed inset-0 z-50 flex flex-col bg-heading/80 backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-2 shadow sm:px-5">
        <p className="mr-auto min-w-0 truncate font-display text-lg text-primary">
          {title} <span className="font-sans text-xs text-slate-text">· Read-only preview</span>
        </p>
        <ToolButton
          label="Previous page"
          onClick={() => goTo(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ChevronLeft />
        </ToolButton>
        <span className="min-w-16 text-center text-sm tabular-nums" aria-live="polite">
          {page}
          {total ? ` / ${total}` : ''}
        </span>
        <ToolButton
          label="Next page"
          onClick={() => goTo(page + 1)}
          disabled={total ? page >= total : false}
        >
          <ChevronRight />
        </ToolButton>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />
        <ToolButton label="Zoom out" onClick={() => setZoom(ZOOMS[zi - 1]!)} disabled={zi <= 0}>
          <ZoomOut />
        </ToolButton>
        <span className="w-12 text-center text-sm tabular-nums">{zoom}%</span>
        <ToolButton
          label="Zoom in"
          onClick={() => setZoom(ZOOMS[zi + 1]!)}
          disabled={zi >= ZOOMS.length - 1}
        >
          <ZoomIn />
        </ToolButton>
        <ToolButton label="Fit width" onClick={() => setZoom(100)}>
          <MoveHorizontal />
        </ToolButton>
        <button
          ref={closeBtn}
          type="button"
          onClick={close}
          className="ml-1 flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          <X className="size-4" aria-hidden /> Close preview
        </button>
      </div>
      <div ref={scroller} className="flex-1 overflow-auto p-4 sm:p-8">
        <div
          className="mx-auto"
          style={{ width: `${zoom}%`, minWidth: zoom > 100 ? `${zoom}%` : undefined }}
        >
          <PdfPages src={`/api/sign/${token}/file`} maxWidth={zoom > 100 ? 4000 : 900} />
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 items-center justify-center rounded-lg text-heading hover:bg-blush disabled:opacity-40 [&>svg]:size-5"
    >
      {children}
    </button>
  );
}
