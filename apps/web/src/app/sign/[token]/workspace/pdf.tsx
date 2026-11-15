'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PageBox = { width: number; height: number };

/**
 * Loads the authorized PDF once. Bytes come from the session-checked file route and are never
 * cached by the browser. `sizes` are each page's size in PDF points at scale 1, rotation applied.
 */
export function usePdf(src: string) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageBox[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    import('pdfjs-dist')
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const res = await fetch(src, { cache: 'no-store' });
        if (res.status === 401 || res.status === 404)
          throw new Error('Your signing session has ended. Open the link in your email again.');
        if (!res.ok) throw new Error('The document could not be loaded.');
        const data = new Uint8Array(await res.arrayBuffer());
        doc = await pdfjs.getDocument({ data }).promise;
        const all: PageBox[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const v = (await doc.getPage(i)).getViewport({ scale: 1 });
          all.push({ width: v.width, height: v.height });
        }
        if (cancelled) return doc.loadingTask.destroy();
        setSizes(all);
        setPdf(doc);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(
          e instanceof Error && e.message.startsWith('Your signing')
            ? e.message
            : 'The document could not be loaded. Check your connection and try again.',
        );
      });
    return () => {
      cancelled = true;
      void doc?.loadingTask.destroy();
    };
  }, [src, attempt]);

  return {
    pdf,
    sizes,
    error,
    retry: () => {
      setError(null);
      setAttempt((a) => a + 1);
    },
  };
}

/**
 * One page rendered at `scale` (CSS px per PDF point). It renders only once it nears the
 * viewport, and re-renders when the scale changes. Children are positioned over the page using
 * page-relative percentages, so fields stay put at any zoom.
 */
export function PdfPageView({
  pdf,
  pageNumber,
  box,
  scale,
  root,
  children,
  thumbnail,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  box: PageBox;
  scale: number;
  root?: HTMLElement | null;
  children?: ReactNode;
  thumbnail?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const width = Math.round(box.width * scale);
  const height = Math.round(box.height * scale);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), {
      root: root ?? null,
      rootMargin: '600px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    // Debounced so a burst of zoom clicks renders once.
    const t = setTimeout(() => {
      void pdf.getPage(pageNumber).then((page) => {
        const c = canvas.current;
        if (cancelled || !c) return;
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, thumbnail ? 1.5 : 3);
        c.width = Math.floor(viewport.width * ratio);
        c.height = Math.floor(viewport.height * ratio);
        task = page.render({
          canvas: c,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        task.promise.catch(() => {});
      });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
      task?.cancel();
    };
  }, [near, pdf, pageNumber, scale, thumbnail]);

  return (
    <div
      ref={wrap}
      data-pdf-page={thumbnail ? undefined : pageNumber}
      className="relative shrink-0 bg-white shadow-card"
      style={{ width, height }}
    >
      <canvas
        ref={canvas}
        role={thumbnail ? undefined : 'img'}
        aria-label={thumbnail ? undefined : `Page ${pageNumber} of ${pdf.numPages}`}
        aria-hidden={thumbnail || undefined}
        className="absolute inset-0 size-full"
      />
      {children}
    </div>
  );
}
