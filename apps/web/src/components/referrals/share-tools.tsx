'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Link2, Mail, Share2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

const GOLD_BTN =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#F3DEB4,#D8AF68)] px-5 font-semibold text-[#0D1B33] shadow-[0_6px_18px_rgba(216,175,104,0.25)] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
const GHOST_BTN =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/30 px-5 font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and some embedded views: fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** A polite live region so copy confirmations reach screen readers. */
function useAnnouncer() {
  const [msg, setMsg] = useState('');
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (m: string) => {
    setMsg(m);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(''), 2500);
  };
  const node = (
    <p role="status" aria-live="polite" className="min-h-5 text-sm text-[#F3DEB4]">
      {msg}
    </p>
  );
  return { say, msg, node };
}

/** Copy, share and the share dialog for one referral link. Lives on the navy hero. */
export function ReferralShareTools({
  url,
  code,
  message,
  referredCredits,
  referrerCredits,
}: {
  url: string;
  code: string;
  message: string;
  referredCredits: number;
  referrerCredits: number;
}) {
  const [open, setOpen] = useState(false);
  const { say, node } = useAnnouncer();
  const shareRef = useRef<HTMLButtonElement>(null);
  const fullMessage = `${message} ${url}`;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <label className="sr-only" htmlFor="referral-link">
          Your referral link
        </label>
        <input
          id="referral-link"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 w-full min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 font-mono text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        />
        <button
          type="button"
          className={GOLD_BTN}
          onClick={async () =>
            say(
              (await copyText(url))
                ? 'Referral link copied.'
                : 'Could not copy. Select the link and copy it.',
            )
          }
        >
          <Copy className="size-4" aria-hidden /> Copy Referral Link
        </button>
        <button ref={shareRef} type="button" className={GHOST_BTN} onClick={() => setOpen(true)}>
          <Share2 className="size-4" aria-hidden /> Share Referral
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[#CBD5E1]">
        <span>
          Referral code:{' '}
          <span className="font-mono font-semibold tracking-wider text-white">{code}</span>
        </span>
        <button
          type="button"
          className="rounded-md px-2 py-1 font-semibold text-[#F3DEB4] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-white"
          onClick={async () =>
            say((await copyText(code)) ? 'Referral code copied.' : 'Could not copy the code.')
          }
        >
          Copy code
        </button>
      </div>
      <div className="mt-2">{node}</div>
      {open ? (
        <ShareDialog
          url={url}
          code={code}
          message={fullMessage}
          referredCredits={referredCredits}
          referrerCredits={referrerCredits}
          onClose={() => {
            setOpen(false);
            shareRef.current?.focus();
          }}
          onCopied={(m) => say(m)}
        />
      ) : null}
    </div>
  );
}

function ShareDialog({
  url,
  code,
  message,
  referredCredits,
  referrerCredits,
  onClose,
  onCopied,
}: {
  url: string;
  code: string;
  message: string;
  referredCredits: number;
  referrerCredits: number;
  onClose: () => void;
  onCopied: (m: string) => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    const root = ref.current;
    root?.querySelector<HTMLElement>('button, a')?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
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
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const enc = encodeURIComponent;
  const links = [
    {
      label: 'Email',
      href: `mailto:?subject=${enc('Try Signature Tender: a free signing credit for you')}&body=${enc(message)}`,
      icon: Mail,
    },
    { label: 'WhatsApp', href: `https://wa.me/?text=${enc(message)}`, icon: Share2 },
    {
      label: 'Facebook',
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
      icon: Share2,
    },
    {
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
      icon: Share2,
    },
  ];
  const tile =
    'flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-heading hover:bg-blush focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D1B33]';

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0D1B33]/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-dvh w-full overflow-y-auto rounded-t-3xl bg-ivory p-6 shadow-2xl sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-2xl text-heading">
            Share Signature Tender
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-heading hover:bg-blush focus-visible:outline-2 focus-visible:outline-[#0D1B33]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-sm">
          Your friend gets {referredCredits} free signing credit{referredCredits === 1 ? '' : 's'}{' '}
          when they join. You get {referrerCredits} when they make their first qualifying purchase.
        </p>
        <div className="mt-5 rounded-2xl border border-border bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-text">
            Referral link
          </p>
          <p className="mt-1 break-all font-mono text-sm text-heading">{url}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-text">
            Referral code
          </p>
          <p className="mt-1 font-mono text-sm font-semibold tracking-wider text-heading">{code}</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target={l.label === 'Email' ? undefined : '_blank'}
              rel="noopener noreferrer"
              className={tile}
            >
              <l.icon className="size-4" aria-hidden /> {l.label}
            </a>
          ))}
          <button
            type="button"
            className={tile}
            onClick={async () => {
              const ok = await copyText(url);
              setCopied(ok);
              onCopied(ok ? 'Referral link copied.' : 'Could not copy the link.');
            }}
          >
            {copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Link2 className="size-4" aria-hidden />
            )}
            {copied ? 'Link copied' : 'Copy Link'}
          </button>
          <button
            type="button"
            className={cn(tile, !canNativeShare && 'hidden')}
            onClick={async () => {
              try {
                await navigator.share({
                  title: 'Signature Tender',
                  text: message.replace(url, '').trim(),
                  url,
                });
              } catch {
                /* the person closed the share sheet */
              }
            }}
          >
            <Share2 className="size-4" aria-hidden /> More options
          </button>
        </div>
        <p className="mt-5 text-xs">
          Share only with people who would welcome it. Signature Tender never emails your contacts
          for you.
        </p>
      </div>
    </div>,
    document.body,
  );
}
