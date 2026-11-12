'use client';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { track, type ProductEvent } from './analytics';

/**
 * Link that records a privacy-conscious analytics event. In-page anchors scroll smoothly
 * (instantly when the visitor prefers reduced motion) and move focus to the target section.
 */
export function TrackedLink({
  event,
  props,
  href,
  onClick,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'href'> & {
  href: string;
  event?: ProductEvent;
  props?: Record<string, string | number | boolean>;
}) {
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        if (event) track(event, props);
        if (href.startsWith('/app/documents/new') || href.includes('next=%2Fapp%2Fdocuments%2Fnew'))
          track('upload_workflow_started', { from: String(props?.from ?? 'product') });
        if (href.startsWith('#')) {
          const el = document.getElementById(href.slice(1));
          if (el) {
            e.preventDefault();
            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
            history.replaceState(null, '', href);
            el.setAttribute('tabindex', '-1');
            el.focus({ preventScroll: true });
          }
        }
        onClick?.(e);
      }}
    />
  );
}
