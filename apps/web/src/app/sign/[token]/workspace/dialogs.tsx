'use client';
import { useEffect, useRef, useState } from 'react';
import { CircleCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';

/** Keeps focus inside an open dialog, closes on Escape, and restores focus on close. */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [
        ...el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, [onClose]);
  return ref;
}

export function HelpPanel({
  onClose,
  senderName,
  authMethod,
}: {
  onClose: () => void;
  senderName: string;
  authMethod: string;
}) {
  const ref = useDialog(onClose);
  const sections: { title: string; body: React.ReactNode }[] = [
    {
      title: 'How to sign',
      body: (
        <ol className="list-decimal space-y-1 pl-5">
          <li>Read the document. Use the page list or the arrows to move between pages.</li>
          <li>
            Select <strong>Next Field</strong> to jump to each field assigned to you. Required
            fields are marked with an asterisk and the word &ldquo;Required&rdquo;.
          </li>
          <li>Create your signature in Signature Studio and select Use This Signature.</li>
          <li>
            When every required field is complete, select <strong>Finish Signing</strong>, review
            the summary, and confirm.
          </li>
        </ol>
      ),
    },
    {
      title: 'Signature Studio help',
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Type</strong>: enter your name, pick one of six styles and a variation, and
            fine-tune it with Customize Style. You never have to draw.
          </li>
          <li>
            <strong>Draw</strong>: sign with a mouse, finger, stylus or trackpad. Undo removes the
            last stroke.
          </li>
          <li>
            <strong>Upload</strong>: use a PNG or JPEG picture of your signature (up to 5 MB).
          </li>
          <li>
            Your signature is only placed where you apply it. &ldquo;Apply to all my signature
            fields&rdquo; asks you to confirm first.
          </li>
        </ul>
      ),
    },
    {
      title: 'Questions about the document',
      body: (
        <p>
          Signature Tender delivers documents but does not write them. For questions about the
          content, contact {senderName}, for example by replying to the invitation email. If you do
          not agree with the document, you can decline to sign from the signing panel.
        </p>
      ),
    },
    {
      title: 'Technical support',
      body: (
        <p>
          If the page will not load or a step keeps failing, refresh the page or open the link in
          your invitation email again. Your saved progress is kept. If it still fails, let{' '}
          {senderName} know so they can resend the request or contact Signature Tender support.
        </p>
      ),
    },
    {
      title: 'Signing troubleshooting',
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>
            &ldquo;Your session has ended&rdquo;: sessions are short for security. Open the link in
            your email again
            {authMethod === 'email_code' ? ' and confirm a new code' : ''}.
          </li>
          <li>&ldquo;Not saved&rdquo;: check your connection and select Retry.</li>
          <li>
            Fields are hard to tap on a phone: select Next Field, and edit the value in the panel
            that opens at the bottom of the screen.
          </li>
          <li>
            Keyboard: Tab moves between fields, Alt + Down arrow goes to the next field, Alt + Up
            arrow to the previous one.
          </li>
        </ul>
      ),
    },
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-heading/40" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="help-title" className="font-display text-2xl">
            Help
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            data-autofocus
            className="rounded-full p-2 hover:bg-blush"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {sections.map((s, i) => (
            <details
              key={s.title}
              open={i === 0}
              className="rounded-xl border border-border p-3 text-sm open:bg-ivory"
            >
              <summary className="cursor-pointer font-semibold text-heading">{s.title}</summary>
              <div className="mt-2">{s.body}</div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FinishDialog({
  title,
  recipientName,
  role,
  requiredDone,
  requiredTotal,
  signaturePreview,
  error,
  busy,
  onBack,
  onComplete,
}: {
  title: string;
  recipientName: string;
  role: string;
  requiredDone: number;
  requiredTotal: number;
  signaturePreview: string | null;
  error: string | null;
  busy: boolean;
  onBack: () => void;
  onComplete: () => void;
}) {
  const ref = useDialog(onBack);
  const [agree, setAgree] = useState(false);
  const signer = role === 'signer';
  const heading = signer
    ? 'Confirm Your Electronic Signature'
    : role === 'approver'
      ? 'Confirm Your Approval'
      : 'Confirm Your Review';
  const statement = signer
    ? 'By selecting Complete Signing, I confirm that I intend to electronically sign this document using the signature I have adopted.'
    : role === 'approver'
      ? `I have reviewed "${title}" and I approve it.`
      : `I have reviewed "${title}".`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-heading/50 sm:items-center sm:p-4"
      onClick={onBack}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-title"
        aria-describedby="finish-statement"
        className="max-h-[95dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-card sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="finish-title" className="font-display text-2xl">
          {heading}
        </h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt>Document</dt>
          <dd className="font-semibold text-heading">{title}</dd>
          <dt>Recipient</dt>
          <dd className="text-heading">{recipientName}</dd>
          <dt>Required fields</dt>
          <dd className="flex items-center gap-1.5 text-heading">
            <CircleCheck className="size-4 text-success" aria-hidden />
            {requiredDone} of {requiredTotal} complete
          </dd>
        </dl>
        {signaturePreview ? (
          <div className="mt-4 flex h-24 items-center justify-center rounded-xl border border-border bg-ivory p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signaturePreview}
              alt="Your adopted signature"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}
        <p id="finish-statement" className="mt-4 text-sm text-heading">
          {signer ? statement : 'Confirm to record your response.'}
        </p>
        <p className="mt-2 text-xs">
          You agreed to use electronic records and signatures before opening this document. Your
          response is recorded with this exact version of the document, the time, and your session
          details.
        </p>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-border p-3 text-sm text-heading">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
            data-autofocus
          />
          {signer
            ? `I have reviewed "${title}" and I intend to sign it electronically.`
            : statement}
        </label>
        {error ? (
          <Alert tone="error" className="mt-3">
            {error}
          </Alert>
        ) : null}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onBack}>
            Back to Document
          </Button>
          <Button
            type="button"
            disabled={!agree}
            loading={busy}
            onClick={onComplete}
            className={cn(!agree && 'pointer-events-auto')}
          >
            {signer
              ? 'Complete Signing'
              : role === 'approver'
                ? 'Complete Approval'
                : 'Complete Review'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RetryDialog({
  message,
  busy,
  onRetry,
  onClose,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const ref = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-heading/50 p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="retry-title"
        aria-describedby="retry-body"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-card"
      >
        <h2 id="retry-title" className="font-display text-xl">
          Your progress was not saved
        </h2>
        <p id="retry-body" className="mt-2 text-sm">
          {message} You are still in the document; nothing was lost on this page.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep working
          </Button>
          <Button type="button" loading={busy} onClick={onRetry} data-autofocus>
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}
