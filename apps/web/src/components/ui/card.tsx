import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag className={cn('rounded-2xl border border-border bg-white p-6 shadow-card', className)}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        {description ? <p className="mt-1 text-sm">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-white p-4 shadow-card sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      <div
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-surface text-primary"
        aria-hidden
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-semibold text-heading">{value}</p>
        <p className="text-sm">{label}</p>
        {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      </div>
    </div>
  );
}
