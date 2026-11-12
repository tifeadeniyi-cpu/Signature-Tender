import type { ReactNode } from 'react';
import {
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock,
  Copy as CopyIcon,
  Eye,
  FileText,
  Hourglass,
  PencilLine,
  TimerOff,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DrawerStatus, SignerStatus } from '@/lib/document-summary-types';

/** Document status pill. Color, icon and text always travel together. */
const STATUS_STYLE: Record<DrawerStatus, { cls: string; Icon: typeof Clock }> = {
  completed: { cls: 'bg-success-bg text-success', Icon: CheckCircle2 },
  in_progress: { cls: 'bg-info-bg text-info', Icon: Clock },
  pending: { cls: 'bg-warning-bg text-warning', Icon: Hourglass },
  draft: { cls: 'bg-slate-100 text-slate-700', Icon: PencilLine },
  declined: { cls: 'bg-error-bg text-error', Icon: XCircle },
  expired: { cls: 'bg-orange-50 text-orange-800 ring-1 ring-orange-200', Icon: TimerOff },
  cancelled: { cls: 'bg-slate-100 text-slate-700', Icon: Ban },
  needs_attention: { cls: 'bg-error-bg text-error', Icon: CircleAlert },
};

export function StatusPill({ status, label }: { status: DrawerStatus; label: string }) {
  const { cls, Icon } = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
        cls,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>
        <span className="sr-only">Status: </span>
        {label}
      </span>
    </span>
  );
}

const SIGNER_STYLE: Record<SignerStatus, { cls: string; Icon: typeof Clock }> = {
  signed: { cls: 'text-success', Icon: CheckCircle2 },
  approved: { cls: 'text-success', Icon: CheckCircle2 },
  reviewed: { cls: 'text-success', Icon: CheckCircle2 },
  pending: { cls: 'text-warning', Icon: Hourglass },
  viewed: { cls: 'text-info', Icon: Eye },
  declined: { cls: 'text-error', Icon: XCircle },
  not_started: { cls: 'text-slate-600', Icon: CircleDashed },
  expired: { cls: 'text-orange-800', Icon: TimerOff },
  cancelled: { cls: 'text-slate-600', Icon: Ban },
  copy: { cls: 'text-slate-600', Icon: CopyIcon },
};

export function SignerStatusLabel({ status, label }: { status: SignerStatus; label: string }) {
  const { cls, Icon } = SIGNER_STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', cls)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

const AVATAR_TONES = [
  'bg-blush text-primary',
  'bg-primary-surface text-primary-dark',
  'bg-rose-gold/40 text-primary-dark',
  'bg-ivory text-primary ring-1 ring-border',
];

export function Initials({
  name,
  index = 0,
  done,
}: {
  name: string;
  index?: number;
  done?: boolean;
}) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const text = (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
  return (
    <span className="relative shrink-0" aria-hidden>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-full text-xs font-semibold',
          AVATAR_TONES[index % AVATAR_TONES.length],
        )}
      >
        {text || '?'}
      </span>
      {done ? (
        <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-white">
          <CheckCircle2 className="size-4 text-success" />
        </span>
      ) : null}
    </span>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-2xl border border-border bg-white p-4 shadow-card', className)}
      aria-label={title}
    >
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-display text-lg text-heading">{title}</h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('block animate-pulse rounded-md bg-primary-surface', className)} />;
}

export function DrawerSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-5" aria-hidden>
      <div className="flex gap-4 rounded-2xl border border-border p-4">
        <Skeleton className="h-24 w-20" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-auto h-9 w-36" />
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex justify-between gap-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

export function DrawerEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-ivory px-6 py-10 text-center">
      <span
        className="flex size-12 items-center justify-center rounded-full bg-blush text-primary"
        aria-hidden
      >
        <FileText className="size-5" />
      </span>
      <h3 className="font-display text-lg text-heading">{title}</h3>
      <p className="max-w-xs text-sm">{children}</p>
    </div>
  );
}

/** A small decorative page used as the document thumbnail. */
export function PaperThumb() {
  return (
    <div
      className="relative flex h-28 w-22 shrink-0 flex-col gap-1.5 rounded-md border border-border bg-white p-3 shadow-card"
      aria-hidden
    >
      <span className="absolute right-0 top-0 size-4 rounded-bl-md bg-blush" />
      <span className="h-1.5 w-3/4 rounded bg-primary/70" />
      <span className="h-1 w-full rounded bg-border" />
      <span className="h-1 w-full rounded bg-border" />
      <span className="h-1 w-5/6 rounded bg-border" />
      <span className="h-1 w-full rounded bg-border" />
      <span className="h-1 w-2/3 rounded bg-border" />
      <span className="mt-auto h-3 w-12 rounded-sm border-b-2 border-primary/60" />
      <span className="absolute -bottom-2 -left-2 rounded bg-primary px-1 text-[9px] font-bold tracking-wide text-white">
        PDF
      </span>
    </div>
  );
}
