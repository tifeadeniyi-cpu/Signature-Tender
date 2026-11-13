'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Printer,
} from 'lucide-react';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { track } from '@/components/product/analytics';

type Fit = 'width' | 'page' | null;
type Size = { width: number; height: number };

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const GAP = 16;
const PAD = 24;

const toolBtn =
  'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-2 text-sm font-medium text-heading hover:bg-blush disabled:cursor-not-allowed disabled:opacity-40';

/**
 * The finalized PDF with page navigation, zoom, fit, download, print and full screen. Bytes come
 * from the authorized file route (each load is recorded as a view). Pages render with their own
 * rotation, and only when they are near the visible area.
 */
export function CompletedPdfViewer({
  src,
  downloadHref,
  allowPrint,
  title,
  certificateFromPage,
}: {
  src: string;
  downloadHref: string | null;
  allowPrint: boolean;
  title: string;
  /** First page of the appended Certificate of Completion, when the file includes one. */
  certificateFromPage?: number | null;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [fit, setFit] = useState<Fit>('width');
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [full, setFull] = useState(false);
  const [printImages, setPrintImages] = useState<string[] | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    import('pdfjs-dist')
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const res = await fetch(src, { cache: 'no-store' });
        if (!res.ok) throw new Error('We could not load the document. Try again in a moment.');
        doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise;
        const all: Size[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
          all.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return doc.loadingTask.destroy();
        setSizes(all);
        setPdf(doc);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'We could not load the document.');
      });
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, [src]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const maxW = sizes.length ? Math.max(...sizes.map((s) => s.width)) : 612;
  const maxH = sizes.length ? Math.max(...sizes.map((s) => s.height)) : 792;
  const availW = Math.max(120, box.width - PAD * 2);
  const availH = Math.max(120, box.height - PAD * 2);
  const scale =
    fit === 'width'
      ? availW / maxW
      : fit === 'page'
        ? Math.min(availW / maxW, availH / maxH)
        : zoom;
  const pct = Math.round(scale * 100);

  // Track the page nearest the top of the visible area.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const pages = el.querySelectorAll<HTMLElement>('[data-page]');
    const mid = el.scrollTop + el.clientHeight / 3;
    let current = 1;
    pages.forEach((p) => {
      if (p.offsetTop <= mid) current = Number(p.dataset.page);
    });
    setPage(current);
  }, []);

  function goTo(n: number) {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (!el || !scroller.current) return;
    scroller.current.scrollTo({ top: el.offsetTop - PAD, behavior: 'auto' });
    setPage(n);
  }

  function zoomBy(dir: 1 | -1) {
    const next =
      dir > 0
        ? (ZOOM_STEPS.find((z) => z > scale + 0.001) ?? ZOOM_STEPS.at(-1)!)
        : ([...ZOOM_STEPS].reverse().find((z) => z < scale - 0.001) ?? ZOOM_STEPS[0]!);
    setFit(null);
    setZoom(next);
  }

  async function toggleFull() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await shell.current?.requestFullscreen?.().catch(() => {});
  }

  async function print() {
    if (!pdf || printing) return;
    setPrinting(true);
    try {
      const images: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const vp = p.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await p.render({ canvas: c, viewport: vp }).promise;
        images.push(c.toDataURL('image/png'));
      }
      setPrintImages(images);
    } catch {
      setError('Printing failed. Download the document and print it from your PDF reader.');
      setPrinting(false);
    }
  }

  // Once the print copy has rendered, open the browser's print dialog, then clean up.
  useEffect(() => {
    if (!printImages) return;
    document.body.classList.add('st-printing');
    const done = () => {
      document.body.classList.remove('st-printing');
      setPrintImages(null);
      setPrinting(false);
    };
    window.addEventListener('afterprint', done, { once: true });
    const t = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('st-printing');
    };
  }, [printImages]);

  const total = pdf?.numPages ?? 0;

  return (
    <div
      ref={shell}
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-card',
        full && 'rounded-none',
      )}
    >
      <div
        role="toolbar"
        aria-label="Document controls"
        className="flex flex-wrap items-center gap-2 border-b border-border bg-white px-3 py-2"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={toolBtn}
            onClick={() => goTo(page - 1)}
            disabled={!pdf || page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span className="min-w-24 px-1 text-center text-sm text-heading" aria-live="polite">
            {total ? `Page ${page} of ${total}` : 'Loading…'}
          </span>
          <button
            type="button"
            className={toolBtn}
            onClick={() => goTo(page + 1)}
            disabled={!pdf || page >= total}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
        {certificateFromPage && total >= certificateFromPage ? (
          <button
            type="button"
            className="rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold text-primary hover:bg-primary-surface"
            onClick={() => goTo(certificateFromPage)}
          >
            View Certificate of Completion
          </button>
        ) : null}
        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={toolBtn}
            onClick={() => zoomBy(-1)}
            disabled={!pdf || scale <= ZOOM_STEPS[0]! + 0.001}
            aria-label="Zoom out"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="w-12 text-center text-sm text-heading" aria-label={`Zoom ${pct}%`}>
            {pct}%
          </span>
          <button
            type="button"
            className={toolBtn}
            onClick={() => zoomBy(1)}
            disabled={!pdf || scale >= ZOOM_STEPS.at(-1)! - 0.001}
            aria-label="Zoom in"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Fit">
          <button
            type="button"
            className={cn(toolBtn, fit === 'width' && 'border-primary text-primary')}
            aria-pressed={fit === 'width'}
            onClick={() => setFit('width')}
            disabled={!pdf}
          >
            Fit width
          </button>
          <button
            type="button"
            className={cn(toolBtn, fit === 'page' && 'border-primary text-primary')}
            aria-pressed={fit === 'page'}
            onClick={() => setFit('page')}
            disabled={!pdf}
          >
            Fit page
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {downloadHref ? (
            <a
              href={downloadHref}
              className={cn(toolBtn, 'px-3 text-primary')}
              onClick={() => track('document_download_clicked', { from: 'viewer' })}
            >
              <Download className="size-4" aria-hidden />
              <span className="hidden sm:inline">Download</span>
              <span className="sr-only sm:hidden">Download</span>
            </a>
          ) : null}
          {allowPrint ? (
            <button
              type="button"
              className={cn(toolBtn, 'px-3 text-primary')}
              onClick={print}
              disabled={!pdf || printing}
              aria-busy={printing || undefined}
            >
              <Printer className="size-4" aria-hidden />
              <span className="hidden sm:inline">{printing ? 'Preparing…' : 'Print'}</span>
              <span className="sr-only sm:hidden">Print</span>
            </button>
          ) : null}
          <button
            type="button"
            className={toolBtn}
            onClick={toggleFull}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            aria-pressed={full}
          >
            {full ? (
              <Minimize2 className="size-4" aria-hidden />
            ) : (
              <Maximize2 className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={`${title}, signed document`}
        className={cn(
          'relative overflow-auto bg-[#f3eeee]',
          full ? 'h-[calc(100dvh-58px)]' : 'h-[70dvh] max-h-[1100px] min-h-[420px] lg:h-[78dvh]',
        )}
      >
        {error ? (
          <div className="p-6">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        {!pdf && !error ? (
          <div className="p-6">
            <Skeleton className="mx-auto aspect-[8.5/11] w-full max-w-[680px]" />
          </div>
        ) : null}
        {pdf && box.width > 0 ? (
          <div
            className="flex w-max min-w-full flex-col items-center"
            style={{ padding: PAD, gap: GAP }}
          >
            {sizes.map((s, i) => (
              <PdfPage
                key={i}
                pdf={pdf}
                n={i + 1}
                total={sizes.length}
                width={Math.floor(s.width * scale)}
                height={Math.floor(s.height * scale)}
                scale={scale}
                root={scroller}
              />
            ))}
          </div>
        ) : null}
      </div>

      {printImages
        ? createPortal(
            <div id="st-print-root" aria-hidden>
              {printImages.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="" />
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function PdfPage({
  pdf,
  n,
  total,
  width,
  height,
  scale,
  root,
}: {
  pdf: PDFDocumentProxy;
  n: number;
  total: number;
  width: number;
  height: number;
  scale: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(n <= 2);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true);
      },
      { root: root.current, rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void pdf.getPage(n).then((p) => {
      if (cancelled || !canvas.current) return;
      const vp = p.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = Math.floor(vp.width * ratio);
      c.height = Math.floor(vp.height * ratio);
      task = p.render({
        canvas: c,
        viewport: vp,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, n, scale, visible]);

  return (
    <div
      ref={wrap}
      data-page={n}
      className="relative shrink-0 bg-white shadow-card"
      style={{ width, height }}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Page ${n} of ${total}`}
        style={{ width, height }}
        className="block"
      />
    </div>
  );
}
