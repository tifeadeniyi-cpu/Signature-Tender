'use client';
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { track } from './analytics';

export interface FaqItem {
  q: string;
  a: string;
}

/** Accessible accordion: buttons with aria-expanded controlling labelled regions. */
export function ProductFAQ({ items }: { items: FaqItem[] }) {
  const base = useId();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <ul className="divide-y divide-border rounded-3xl border border-border bg-white shadow-card">
      {items.map((item, i) => {
        const expanded = open === i;
        const btn = `${base}-q${i}`;
        const panel = `${base}-a${i}`;
        return (
          <li key={item.q}>
            <h3>
              <button
                id={btn}
                type="button"
                aria-expanded={expanded}
                aria-controls={panel}
                onClick={() => {
                  setOpen(expanded ? null : i);
                  if (!expanded) track('faq_expanded', { question: i + 1 });
                }}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold text-heading hover:text-primary sm:px-6"
              >
                {item.q}
                <ChevronDown
                  className={cn(
                    'size-5 shrink-0 text-primary transition-transform',
                    expanded && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
            </h3>
            <div
              id={panel}
              role="region"
              aria-labelledby={btn}
              hidden={!expanded}
              className="px-5 pb-5 text-[15px] leading-relaxed sm:px-6"
            >
              {item.a}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
