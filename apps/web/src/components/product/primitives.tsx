import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Section({
  id,
  tone = 'light',
  className,
  children,
  labelledBy,
}: {
  id?: string;
  tone?: 'light' | 'blush' | 'dark' | 'white';
  className?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn(
        'relative scroll-mt-20 overflow-hidden',
        tone === 'dark' &&
          'bg-gradient-to-br from-primary-dark via-primary to-primary-hover text-white',
        tone === 'blush' && 'bg-blush/50',
        tone === 'white' && 'bg-white',
        className,
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">{children}</div>
    </section>
  );
}

export function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <p
      className={cn(
        'inline-block rounded-full border px-4 py-1 text-xs font-semibold tracking-[0.18em]',
        dark ? 'border-rose-gold/60 text-rose-gold' : 'border-primary/20 bg-white text-primary',
      )}
    >
      {children}
    </p>
  );
}

export function Heading({
  id,
  children,
  sub,
  dark,
  center,
}: {
  id: string;
  children: ReactNode;
  sub?: ReactNode;
  dark?: boolean;
  center?: boolean;
}) {
  return (
    <div className={cn('max-w-3xl', center && 'mx-auto text-center')}>
      <h2
        id={id}
        className={cn(
          'font-display text-3xl leading-tight sm:text-4xl lg:text-[2.75rem]',
          dark && 'text-white',
        )}
      >
        {children}
      </h2>
      {sub ? (
        <p className={cn('mt-4 text-lg', dark ? 'text-white/80' : 'text-slate-text')}>{sub}</p>
      ) : null}
    </div>
  );
}

/** Marks a visual as a demonstration with fictional data. */
export function DemoLabel({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider',
        dark ? 'bg-white/15 text-white' : 'bg-primary-surface text-primary',
        className,
      )}
    >
      Product demonstration · fictional data
    </span>
  );
}

export type Availability = 'available' | 'beta' | 'soon';

export function AvailabilityBadge({
  value,
  className,
}: {
  value: Availability;
  className?: string;
}) {
  const map = {
    available: ['Available', 'bg-success-bg text-success'],
    beta: ['Beta', 'bg-info-bg text-info'],
    soon: ['Coming soon', 'bg-warning-bg text-warning'],
  } as const;
  const [label, cls] = map[value];
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold',
        cls,
        className,
      )}
    >
      {label}
    </span>
  );
}

export function CheckList({
  items,
  dark,
  columns,
}: {
  items: (string | { label: string; soon?: boolean })[];
  dark?: boolean;
  columns?: boolean;
}) {
  return (
    <ul className={cn('grid gap-3', columns && 'sm:grid-cols-2')}>
      {items.map((it) => {
        const { label, soon } = typeof it === 'string' ? { label: it, soon: false } : it;
        return (
          <li key={label} className="flex items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                soon
                  ? 'border border-dashed border-current opacity-60'
                  : dark
                    ? 'bg-rose-gold text-primary-dark'
                    : 'bg-primary text-white',
              )}
              aria-hidden
            >
              {soon ? null : <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <span className={cn('text-[15px]', dark ? 'text-white/90' : 'text-heading')}>
              {label}
              {soon ? <AvailabilityBadge value="soon" className="ml-2 align-middle" /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export type Status = 'completed' | 'pending' | 'declined' | 'not_started' | 'draft' | 'expired';

const STATUS: Record<Status, [string, string]> = {
  completed: ['Completed', 'bg-success-bg text-success'],
  pending: ['Pending', 'bg-warning-bg text-warning'],
  declined: ['Declined', 'bg-error-bg text-error'],
  not_started: ['Not started', 'bg-slate-100 text-slate-600'],
  draft: ['Draft', 'bg-slate-100 text-slate-600'],
  expired: ['Expired', 'bg-error-bg text-error'],
};

/** Status with colour and a text label (colour is never the only signal). */
export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const [text, cls] = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        cls,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label ?? text}
    </span>
  );
}

/** A soft decorative signature stroke used on dark sections. */
export function SignatureStroke({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 120"
      fill="none"
      aria-hidden
      className={cn('pointer-events-none', className)}
    >
      <path
        d="M10 90c40-50 70-70 90-55s-25 55 5 45 45-70 75-60-10 60 25 50 40-55 70-45 5 45 40 38c60-12 150-30 275-62"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
