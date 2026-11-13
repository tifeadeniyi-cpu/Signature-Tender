'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, FolderOpen } from 'lucide-react';
import { track } from '@/components/product/analytics';
import { cn } from '@/lib/cn';

const BENEFITS = [
  ['Store and access signed documents', 'Keep the agreements you add organized in your account.'],
  ['Track future signing requests', 'See document status and activity in one place.'],
  ['Receive signing notifications', 'Stay informed about future signing activity.'],
  ['Manage agreements securely', 'Organize and retrieve documents with access controls.'],
] as const;

const primaryCta =
  'group inline-flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-primary-dark via-primary to-primary-hover px-6 text-lg font-semibold text-white shadow-[0_8px_20px_rgb(91_10_28/0.25)] transition hover:from-primary hover:to-[#8f2445] hover:shadow-[0_10px_24px_rgb(91_10_28/0.32)] focus-visible:outline-offset-4 disabled:opacity-60';

/** Desktop and phone preview drawn in brand colours (no screenshots of real customer data). */
function ProductPreview() {
  return (
    <svg viewBox="0 0 320 170" className="mx-auto h-auto w-full max-w-[300px]" aria-hidden>
      <ellipse cx="160" cy="150" rx="150" ry="16" fill="#f3d3da" opacity="0.7" />
      <circle cx="210" cy="70" r="70" fill="#f6f0e7" />
      <rect x="40" y="18" width="200" height="124" rx="8" fill="#0d1b33" />
      <rect x="47" y="25" width="186" height="110" rx="3" fill="#fff" />
      <rect x="47" y="25" width="186" height="26" rx="3" fill="#0d1b33" />
      <circle cx="60" cy="38" r="5" fill="#d8af68" />
      <rect x="70" y="35" width="44" height="6" rx="3" fill="#fff" opacity="0.9" />
      {[60, 76, 92, 108].map((y, i) => (
        <g key={y}>
          <rect x="56" y={y} width="8" height="8" rx="2" fill={i === 0 ? '#15803d' : '#d8af68'} />
          <rect x="70" y={y + 1} width="70" height="5" rx="2.5" fill="#d9cdd0" />
          <rect x="176" y={y} width="44" height="8" rx="4" fill={i === 0 ? '#dcfce7' : '#eaeef5'} />
        </g>
      ))}
      <path d="M28 142 h224 l-10 8 h-204 z" fill="#475569" />
      <rect x="236" y="54" width="54" height="100" rx="9" fill="#0d1b33" />
      <rect x="240" y="60" width="46" height="88" rx="6" fill="#fff" />
      <rect x="240" y="60" width="46" height="18" rx="6" fill="#0d1b33" />
      <circle cx="263" cy="69" r="3.5" fill="#d8af68" />
      {[86, 100, 114].map((y, i) => (
        <g key={y}>
          <rect x="246" y={y} width="34" height="9" rx="3" fill={i === 0 ? '#dcfce7' : '#eaeef5'} />
        </g>
      ))}
      <rect x="248" y="130" width="30" height="9" rx="4.5" fill="#0d1b33" />
    </svg>
  );
}

function storageKey(requestId: string) {
  return `st_promo_dismissed:${requestId}`;
}

/**
 * The optional free-account offer beside a completed document. Dismissing it never affects access
 * to the document, download, print or evidence, and it stays dismissed for this browser session.
 */
export function AccountPromo({
  requestId,
  startAction,
}: {
  requestId: string;
  /** Server action that keeps a reference to this document and opens sign-up (or sign-in). */
  startAction: () => Promise<void>;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey(requestId))) setDismissed(true);
    } catch {
      // Storage can be blocked; the offer then simply shows again.
    }
  }, [requestId]);

  function dismiss() {
    setDismissed(true);
    track('registration_dismissed');
    try {
      sessionStorage.setItem(storageKey(requestId), '1');
    } catch {
      // Ignore: dismissal still applies until the page reloads.
    }
  }

  const form = (content: React.ReactNode, className?: string) => (
    <form
      action={async () => {
        setBusy(true);
        track('create_free_account_clicked');
        await startAction();
      }}
      className={className}
    >
      {content}
    </form>
  );

  if (dismissed)
    return (
      <aside
        aria-label="Signature Tender account"
        className="rounded-2xl border border-border bg-white/70 p-4 text-sm"
      >
        {form(
          <p>
            Want to keep this document in one place?{' '}
            <button
              type="submit"
              className="font-semibold text-primary underline-offset-2 hover:underline"
              disabled={busy}
            >
              Create an account anytime.
            </button>
          </p>,
        )}
      </aside>
    );

  return (
    <aside
      aria-labelledby="promo-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-gradient-to-b from-blush via-[#fdf1f3] to-ivory p-6 shadow-card"
    >
      <ProductPreview />
      <div className="text-center">
        <h2 id="promo-heading" className="font-display text-2xl leading-tight sm:text-[1.75rem]">
          Manage Your Documents with Signature Tender
        </h2>
        <p className="mt-3 text-[0.95rem] leading-relaxed text-heading/80">
          Create a free account to store this document, track future signings, and manage all your
          agreements in one secure place.
        </p>
      </div>
      <ul className="flex flex-col gap-3" aria-label="What you get with a free account">
        {BENEFITS.map(([title, detail]) => (
          <li key={title} className="flex gap-3">
            <Check className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
            <span>
              <span className="block text-sm font-semibold text-heading">{title}</span>
              <span className="block text-xs">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs">
        No subscription needed. You only pay if you send documents for signature yourself.
      </p>
      {form(
        <button type="submit" className={primaryCta} disabled={busy} aria-busy={busy || undefined}>
          Create Free Account
          <ArrowRight
            className="size-5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>,
      )}
      <a
        href="#document"
        onClick={dismiss}
        className="mx-auto inline-flex min-h-11 items-center px-3 text-base font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
      >
        I&apos;ll do this later
      </a>
    </aside>
  );
}

/** For signed-in visitors: no sign-up offer, just their documents and saving this one. */
export function ExistingCustomerPanel({
  saveAction,
  saved,
  className,
}: {
  saveAction: (() => Promise<void>) | null;
  saved: boolean;
  className?: string;
}) {
  return (
    <aside
      aria-labelledby="manage-heading"
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-b from-blush to-ivory p-6 shadow-card',
        className,
      )}
    >
      <FolderOpen className="size-8 text-primary" aria-hidden />
      <h2 id="manage-heading" className="font-display text-2xl">
        Manage Your Agreements
      </h2>
      <p className="text-sm">
        {saved
          ? 'This document is saved in your account under Documents signed by me.'
          : 'Keep this signed document with your other agreements in your account.'}
      </p>
      {saveAction && !saved ? (
        <form action={saveAction}>
          <button type="submit" className={primaryCta}>
            Save to My Documents
            <ArrowRight className="size-5" aria-hidden />
          </button>
        </form>
      ) : null}
      <Link
        href="/my-documents"
        className={cn(
          saveAction && !saved
            ? 'mx-auto inline-flex min-h-11 items-center px-3 font-medium text-primary underline-offset-4 hover:underline'
            : primaryCta,
        )}
      >
        Go to My Documents
        {saveAction && !saved ? null : <ArrowRight className="size-5" aria-hidden />}
      </Link>
    </aside>
  );
}
