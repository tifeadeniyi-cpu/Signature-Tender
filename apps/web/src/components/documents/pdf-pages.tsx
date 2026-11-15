'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Alert, Skeleton } from '@/components/ui/feedback';

type PageSize = { width: number; height: number };
/** `size` is the rendered size in CSS pixels; `points` is the page size in PDF points (as shown). */
type Overlay = (page: number, size: PageSize, points: PageSize) => ReactNode;

/**
 * Renders every page of a PDF to canvases sized to the container width. Bytes come from the
 * authorized file route; nothing is cached by the browser. `overlay` draws on top of each page.
 */
export function PdfPages({
  src,
  overlay,
  onPageClick,
  maxWidth = 820,
}: {
  src: string;
  overlay?: Overlay;
  onPageClick?: (page: number, x: number, y: number) => void;
  maxWidth?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    import('pdfjs-dist')
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const res = await fetch(src, { cache: 'no-store' });
        if (!res.ok) throw new Error('The document could not be loaded.');
        const data = new Uint8Array(await res.arrayBuffer());
        doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return doc.loadingTask.destroy();
        setPdf(doc);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'The document could not be loaded.');
      });
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, [src]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.min(maxWidth, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  return (
    <div ref={wrap} className="w-full">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!pdf && !error ? (
        <Skeleton className="mx-auto aspect-[8.5/11] w-full max-w-[820px]" />
      ) : null}
      {pdf && width > 0 ? (
        <div className="flex flex-col items-center gap-6">
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage
              key={i}
              pdf={pdf}
              pageNumber={i + 1}
              width={width}
              overlay={overlay}
              onPageClick={onPageClick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PdfPage({
  pdf,
  pageNumber,
  width,
  overlay,
  onPageClick,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  overlay?: Overlay;
  onPageClick?: (page: number, x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<PageSize | null>(null);
  const [points, setPoints] = useState<PageSize | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void pdf.getPage(pageNumber).then((page) => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = width / base.width;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      setSize({ width: viewport.width, height: viewport.height });
      setPoints({ width: base.width, height: base.height });
      task = page.render({
        canvas: c,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, width]);

  return (
    <div
      data-pdf-page={pageNumber}
      className="relative bg-white shadow-card"
      style={size ? { width: size.width, height: size.height } : { width }}
    >
      <canvas
        ref={canvas}
        aria-label={`Page ${pageNumber} of ${pdf.numPages}`}
        role="img"
        onClick={(e) => {
          if (!onPageClick || !size) return;
          const r = e.currentTarget.getBoundingClientRect();
          onPageClick(pageNumber, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }}
        className={onPageClick ? 'cursor-crosshair' : undefined}
      />
      {size && points && overlay ? overlay(pageNumber, size, points) : null}
      <span className="absolute -bottom-5 right-0 text-xs text-slate-500">
        Page {pageNumber} of {pdf.numPages}
      </span>
    </div>
  );
}
