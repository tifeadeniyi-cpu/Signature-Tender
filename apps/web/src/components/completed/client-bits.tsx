'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { track, type ProductEvent } from '@/components/product/analytics';

/** Records one analytics event when the page mounts. Never pass personal data as props. */
export function TrackOnMount({
  event,
  props,
  onceKey,
}: {
  event: ProductEvent;
  props?: Record<string, string | number | boolean>;
  /** When set, the event is recorded once per browser session for this key. */
  onceKey?: string;
}) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (onceKey) {
      try {
        if (sessionStorage.getItem(onceKey)) return;
        sessionStorage.setItem(onceKey, '1');
      } catch {
        // Storage can be blocked; recording twice is acceptable.
      }
    }
    track(event, props);
  }, [event, props, onceKey]);
  return null;
}

/**
 * Refreshes the page while the final document is being produced. Checks every 5 seconds for
 * three minutes, then stops and says the email will follow.
 */
export function FinalizingPoller() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    let n = 0;
    const t = window.setInterval(() => {
      n += 1;
      if (n > 36) {
        window.clearInterval(t);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, 5000);
    return () => window.clearInterval(t);
  }, [router]);
  return gaveUp ? (
    <p className="text-sm">
      This is taking longer than usual. We&apos;ll email you as soon as the document is ready, or
      reload this page to check again.
    </p>
  ) : null;
}

/** A download link that records an analytics event. */
export function DownloadLink({
  href,
  className,
  children,
  from,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  from: string;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => track('document_download_clicked', { from })}
    >
      {children}
    </a>
  );
}

/** Retry for the "couldn't load" state. */
export function RetryButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <button type="button" className={className} onClick={() => router.refresh()}>
      Retry
    </button>
  );
}
