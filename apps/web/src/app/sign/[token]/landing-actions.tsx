'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye } from 'lucide-react';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { startAction, type SignResult } from './actions';

/**
 * Primary and preview buttons. Both start a protected session first (emailing a code when the
 * sender asked for one); consent is still collected before any fields can be completed.
 */
export function LandingActions({
  token,
  cta,
  codeRequired,
  recipientEmail,
}: {
  token: string;
  cta: string;
  codeRequired: boolean;
  recipientEmail: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<SignResult>(null);
  const [which, setWhich] = useState<'sign' | 'preview' | null>(null);
  const [pending, start] = useTransition();

  const go = (kind: 'sign' | 'preview') => {
    if (pending) return;
    setWhich(kind);
    start(async () => {
      const r = await startAction(token);
      setState(r);
      if (r?.ok) {
        if (kind === 'preview') router.replace(`/sign/${token}?preview=1`);
        else router.refresh();
      }
    });
  };

  return (
    <div className="mt-6 flex flex-col gap-3">
      {state && !state.ok && state.message ? <Alert tone="error">{state.message}</Alert> : null}
      <button
        type="button"
        onClick={() => go('sign')}
        disabled={pending}
        aria-busy={pending && which === 'sign'}
        className={cn(
          'flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-b from-[#8b1a3c] to-primary px-6 font-display text-xl text-white shadow-md transition',
          'hover:from-primary-hover hover:to-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:cursor-not-allowed disabled:opacity-70',
        )}
      >
        {pending && which === 'sign' ? <Spinner /> : null}
        {cta}
        {!(pending && which === 'sign') ? <ArrowRight className="size-5" aria-hidden /> : null}
      </button>
      <button
        type="button"
        onClick={() => go('preview')}
        disabled={pending}
        aria-busy={pending && which === 'preview'}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-primary/30 bg-white px-6 font-semibold text-primary transition hover:border-primary hover:bg-blush/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending && which === 'preview' ? <Spinner /> : <Eye className="size-5" aria-hidden />}
        Preview Document
      </button>
      {codeRequired ? (
        <p className="text-center text-xs">
          For your security we&apos;ll email a 6-digit code to {recipientEmail} first.
        </p>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
