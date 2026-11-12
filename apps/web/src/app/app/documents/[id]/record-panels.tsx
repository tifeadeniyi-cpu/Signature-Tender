'use client';
import { useActionState, useState } from 'react';
import { Eye, FileSearch, ShieldCheck, ShieldAlert, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormStatus } from '@/components/ui/form-status';
import { PdfPages } from '@/components/documents/pdf-pages';
import { legalHoldAction } from '../library-actions';

/** Loads the preview only on request, because each view is recorded in the audit log. */
export function PreviewOnDemand({ src, label }: { src: string; label: string }) {
  const [show, setShow] = useState(false);
  if (show) return <PdfPages src={src} maxWidth={760} />;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-blush/30 px-4 py-10 text-center">
      <FileSearch className="size-8 text-primary" aria-hidden />
      <p className="text-sm">Opening the preview is recorded in the document&apos;s activity.</p>
      <Button type="button" variant="secondary" onClick={() => setShow(true)}>
        <Eye className="size-4" aria-hidden /> Show {label}
      </Button>
    </div>
  );
}

type Known = { label: string; sha256: string };

/** Compares a file on this device with the stored hashes. The file never leaves the browser. */
export function CheckCopy({ known }: { known: Known[] }) {
  const [result, setResult] = useState<{ name: string; hash: string; match: Known | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
        '',
      );
      setResult({ name: file.name, hash, match: known.find((k) => k.sha256 === hash) ?? null });
    } catch {
      setError('This browser could not read the file.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-heading" htmlFor="check-copy">
        Check a copy
      </label>
      <p className="text-xs">
        Pick a PDF someone sent you. We compare its fingerprint with the versions stored here. The
        file stays on your device.
      </p>
      <input
        id="check-copy"
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(e) => void onFile(e.target.files?.[0])}
        className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-white file:px-3 file:py-1.5 file:text-sm"
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {result ? (
        result.match ? (
          <p role="status" className="flex items-start gap-2 text-sm text-success">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Matches the {result.match.label}. It has not been changed.
          </p>
        ) : (
          <p role="status" className="flex items-start gap-2 text-sm text-error">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {result.name} does not match any version of this document. It may have been changed or
            be a different file.
          </p>
        )
      ) : null}
    </div>
  );
}

export function LegalHoldForm({
  documentId,
  hold,
  reason,
}: {
  documentId: string;
  hold: boolean;
  reason: string | null;
}) {
  const [state, act, pending] = useActionState(legalHoldAction.bind(null, documentId), null);
  return (
    <form action={act} className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <p className="flex items-center gap-2 text-sm font-medium text-heading">
        <Gavel className="size-4" aria-hidden /> Legal hold
      </p>
      {hold ? (
        <>
          <p className="text-xs">On hold: {reason}. Files cannot be deleted while this is on.</p>
          <Button type="submit" variant="secondary" size="sm" loading={pending}>
            Lift legal hold
          </Button>
        </>
      ) : (
        <>
          <input type="hidden" name="hold" value="on" />
          <label htmlFor="hold-reason" className="text-xs">
            Reason (required)
          </label>
          <input
            id="hold-reason"
            name="reason"
            required
            maxLength={500}
            className="h-9 rounded-lg border border-border px-3 text-sm"
          />
          <Button type="submit" variant="secondary" size="sm" loading={pending}>
            Place legal hold
          </Button>
        </>
      )}
      <FormStatus state={state} />
    </form>
  );
}
