import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

/**
 * A KPI card: the value, what it counts (info), and the change against the comparison period.
 * `goodWhenUp` decides the colour, so a rise in failures is never shown as good news.
 */
export function Kpi({
  label,
  value,
  icon,
  change,
  compareLabel,
  sub,
  info,
  href,
  goodWhenUp = true,
  unit = '%',
}: {
  label: string;
  value: string;
  icon: ReactNode;
  change: number | null;
  compareLabel: string | null;
  sub?: string;
  info: string;
  href?: string;
  goodWhenUp?: boolean;
  unit?: '%' | 'pp';
}) {
  const up = change != null && change > 0.05;
  const down = change != null && change < -0.05;
  const good = (up && goodWhenUp) || (down && !goodWhenUp);
  const bad = (down && goodWhenUp) || (up && !goodWhenUp);
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus;
  const body = (
    <div className="flex h-full gap-3 rounded-2xl border border-border bg-white p-4 shadow-card transition-shadow hover:shadow-md">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cream text-heading"
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-sm font-semibold text-heading">
          {label}
          <span className="cursor-help text-xs font-normal text-slate-text" title={info}>
            ⓘ<span className="sr-only">{info}</span>
          </span>
        </span>
        <span className="block font-display text-2xl text-heading tabular-nums">{value}</span>
        {compareLabel ? (
          <span className="flex flex-wrap items-center gap-1 text-xs">
            {change == null ? (
              <span className="text-slate-text">No earlier data to compare</span>
            ) : (
              <span
                className={
                  good
                    ? 'font-semibold text-success'
                    : bad
                      ? 'font-semibold text-error'
                      : 'text-slate-text'
                }
              >
                <Icon className="inline size-3" aria-hidden /> {change > 0 ? '+' : ''}
                {change.toFixed(1)}
                {unit === 'pp' ? ' pp' : '%'}
              </span>
            )}
            {change == null ? null : (
              <span className="text-slate-text">vs. {compareLabel.toLowerCase()}</span>
            )}
          </span>
        ) : null}
        {sub ? <span className="block text-xs text-slate-text">{sub}</span> : null}
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-2">
      {body}
    </Link>
  ) : (
    body
  );
}
