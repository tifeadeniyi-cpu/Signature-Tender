'use client';
import { useEffect, useRef, useState } from 'react';
import { CircleHelp, ChevronDown } from 'lucide-react';

const TIPS: { title: string; body: string }[] = [
  {
    title: 'Signing help',
    body: 'Open the document, complete each highlighted field assigned to you, then confirm. You do not need a Signature Tender account and you are never asked to pay.',
  },
  {
    title: 'Troubleshooting',
    body: 'If the page will not load, open the newest invitation email, since older links stop working. Codes expire after 10 minutes; request a new one if yours has. Try another browser if the document does not appear.',
  },
];

/** Compact support menu for recipients. No app navigation: this experience is only for signing. */
export function HelpMenu({ supportEmail }: { supportEmail: string }) {
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
      >
        <CircleHelp className="size-5" aria-hidden />
        Help
        <ChevronDown className="size-4 opacity-70" aria-hidden />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-border bg-white p-2 text-sm shadow-lg">
          {TIPS.map((t, i) => (
            <div key={t.title}>
              <button
                type="button"
                aria-expanded={tip === i}
                onClick={() => setTip(tip === i ? null : i)}
                className="w-full rounded-lg px-3 py-2 text-left font-medium text-heading hover:bg-blush"
              >
                {t.title}
              </button>
              {tip === i ? <p className="px-3 pb-2 text-xs leading-relaxed">{t.body}</p> : null}
            </div>
          ))}
          <a
            href={`mailto:${supportEmail}`}
            className="block rounded-lg px-3 py-2 font-medium text-heading hover:bg-blush"
          >
            Contact support
          </a>
          <a
            href="/legal/privacy"
            target="_blank"
            rel="noopener"
            className="block rounded-lg px-3 py-2 font-medium text-heading hover:bg-blush"
          >
            Privacy &amp; security
          </a>
        </div>
      ) : null}
    </div>
  );
}
