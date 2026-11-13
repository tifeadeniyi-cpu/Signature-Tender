'use client';
import { useState } from 'react';
import { CheckCircle2, FileSearch, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkFileHash } from './actions';

const MATCH_TEXT: Record<string, { ok: boolean; title: string; body: string }> = {
  package: {
    ok: true,
    title: 'Document hash matches',
    body: 'This file is identical to the stored complete package (signed agreement with its Certificate of Completion).',
  },
  signed: {
    ok: true,
    title: 'Document hash matches',
    body: 'This file is identical to the stored signed agreement.',
  },
  certificate: {
    ok: true,
    title: 'Document hash matches',
    body: 'This file is identical to the stored Certificate of Completion.',
  },
  original: {
    ok: true,
    title: 'Matches the original upload',
    body: 'This file is the document as uploaded before signing. It does not contain the signatures.',
  },
  none: {
    ok: false,
    title: 'Document hash does not match',
    body: 'This file is not identical to any stored file for this reference. It may have been changed, re-saved or printed to PDF, or it belongs to another agreement.',
  },
};

/** Hashes a PDF in the browser (Web Crypto) and asks the server whether it matches. */
export function HashCheck({ verificationRef }: { verificationRef: string }) {
  const [state, setState] = useState<
    { s: 'idle' } | { s: 'busy' } | { s: 'done'; match: string } | { s: 'error'; msg: string }
  >({ s: 'idle' });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      setState({ s: 'error', msg: 'Choose a PDF smaller than 50 MB.' });
      return;
    }
    setState({ s: 'busy' });
    try {
      const digest = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
      const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
        '',
      );
      const r = await checkFileHash(verificationRef, hex);
      if (r.error || !r.match) setState({ s: 'error', msg: r.error ?? 'The check failed.' });
      else setState({ s: 'done', match: r.match });
    } catch {
      setState({ s: 'error', msg: 'The file could not be read. Try again.' });
    }
  };

  const m = state.s === 'done' ? MATCH_TEXT[state.match] : null;
  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-xl text-heading">
        <FileSearch className="size-5 text-gold" aria-hidden /> Check a copy
      </h2>
      <p className="mt-1 text-sm">
        Choose the PDF you received. Its SHA-256 fingerprint is calculated on your device and
        compared with the stored files. The file is not uploaded.
      </p>
      <label className="mt-4 block text-sm font-medium text-heading">
        PDF file
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:font-semibold file:text-white"
          onChange={(e) => onFile(e.target.files?.[0])}
          disabled={state.s === 'busy'}
        />
      </label>
      <div aria-live="polite" className="mt-4">
        {state.s === 'busy' ? <p className="text-sm">Checking…</p> : null}
        {state.s === 'error' ? (
          <p className="text-sm text-error" role="alert">
            {state.msg}
          </p>
        ) : null}
        {m ? (
          <div
            className={`flex gap-3 rounded-xl p-3 ${m.ok ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}
          >
            {m.ok ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden />
            )}
            <div>
              <p className="font-semibold">{m.title}</p>
              <p className="text-sm text-dark-text">{m.body}</p>
            </div>
          </div>
        ) : null}
        {state.s !== 'idle' && state.s !== 'busy' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setState({ s: 'idle' })}
          >
            Check another file
          </Button>
        ) : null}
      </div>
    </div>
  );
}
