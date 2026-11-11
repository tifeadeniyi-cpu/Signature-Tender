import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'success' | 'error' | 'warning' | 'info';
const tones: Record<Tone, { cls: string; Icon: typeof Info; label: string }> = {
  success: { cls: 'bg-success-bg text-success', Icon: CircleCheck, label: 'Success' },
  error: { cls: 'bg-error-bg text-error', Icon: CircleAlert, label: 'Error' },
  warning: { cls: 'bg-warning-bg text-warning', Icon: TriangleAlert, label: 'Warning' },
  info: { cls: 'bg-info-bg text-info', Icon: Info, label: 'Note' },
};

/** Inline message. Always pairs an icon and text with color so status never relies on color alone. */
export function Alert({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  const { cls, Icon, label } = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', cls, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <span className="sr-only">{label}: </span>
        {children}
      </span>
    </div>
  );
}

export function Badge({
  tone = 'info',
  children,
}: {
  tone?: Tone | 'neutral';
  children: ReactNode;
}) {
  const cls = tone === 'neutral' ? 'bg-primary-surface text-primary' : tones[tone].cls;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        cls,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-white px-6 py-12 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-full bg-blush text-primary"
        aria-hidden
      >
        {icon}
      </div>
      <h2 className="font-display text-xl">{title}</h2>
      {children ? <div className="max-w-md text-sm">{children}</div> : null}
      {action}
    </div>
  );
}

export function PermissionDenied({ what }: { what: string }) {
  return (
    <EmptyState icon={<Lock className="size-5" />} title="You don't have access">
      Your role in this workspace does not allow you to {what}. Ask a workspace owner or admin if
      you need access.
    </EmptyState>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-lg bg-primary-surface', className)} aria-hidden />
  );
}
