'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { track } from './analytics';

/**
 * Slides a section into place the first time it scrolls into view and records one
 * `feature_section_viewed` event. Content is visible without JavaScript and is never hidden
 * for visitors who prefer reduced motion.
 */
export function Reveal({
  name,
  children,
  className,
}: {
  name: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'static' | 'hidden' | 'shown'>('static');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const below = el.getBoundingClientRect().top > window.innerHeight * 0.9;
    let raf = 0;
    if (!reduce && below) raf = requestAnimationFrame(() => setState('hidden'));
    let seen = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setState((s) => (s === 'hidden' ? 'shown' : s));
        if (!seen) {
          seen = true;
          track('feature_section_viewed', { section: name });
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [name]);
  return (
    <div
      ref={ref}
      className={cn(
        // Slide only, never fade: text keeps full contrast at every moment of the animation.
        'transition-transform duration-700 ease-out',
        state === 'hidden' && 'translate-y-8',
        state === 'shown' && 'translate-y-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Records one product_page_viewed event per visit. */
export function PageViewTracker() {
  useEffect(() => {
    track('product_page_viewed');
  }, []);
  return null;
}
