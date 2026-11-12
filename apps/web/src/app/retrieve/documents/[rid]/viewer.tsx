'use client';
import { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { PdfPages } from '@/components/documents/pdf-pages';
import { Button } from '@/components/ui/button';
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

/** Shows the PDF (each load is logged as a view). Pass open={false} to load it only on request. */
export function ViewerOnDemand({
  src,
  pages,
  open = true,
}: {
  src: string;
  pages: number | null;
  open?: boolean;
}) {
  const [show, setShow] = useState(open);
  if (show) return <PdfPages src={src} maxWidth={760} />;
  return (
    <div className="flex flex-col items-start gap-2 py-6">
      <p className="text-sm">
        {pages ? `${pages} page${pages === 1 ? '' : 's'}. ` : ''}Scroll through every page here.
      </p>
      <Button type="button" variant="secondary" onClick={() => setShow(true)}>
        <Eye className="size-4" aria-hidden /> Show the document
      </Button>
    </div>
  );
}
