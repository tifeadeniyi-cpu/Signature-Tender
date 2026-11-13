'use client';
import { useEffect, useRef } from 'react';
import { Alert } from '@/components/ui/feedback';

/** Starts the signed-copy download once, for the email's Download button. */
export function AutoDownload({ href }: { href: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    window.location.assign(href);
  }, [href]);
  return (
    <Alert tone="success">
      Your download should start in a moment. If it does not, use the Download signed document
      button below.
    </Alert>
  );
}
