import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Admin charts. Plain HTML/SVG, rendered on the server: a native tooltip on every mark, a
 * legend for two or more series, and a table view so nothing depends on seeing the chart.
 * Colours follow the brand: Midnight Navy, Champagne Gold, Burgundy, Muted Blue, Gray.
 */
export const SERIES = {
  navy: '#0D1B33',
  gold: '#D8AF68',
  burgundy: '#9D1737',
  blue: '#3E6CA8',
  gray: '#9CA3AF',
  green: '#218547',
} as const;

const nf = (n: number) => n.toLocaleString('en-US');

function TableView({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-semibold text-primary">Show as table</summary>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="py-1 pr-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              {r.map((c, j) => (
                <td key={j} className="py-1 pr-2 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars, one or more series side by side per interval, on one axis. */
export function ColumnChart({
  caption,
  labels,
  series,
  format = nf,
  empty = 'No activity was recorded for the selected period.',
}: {
  caption: string;
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  format?: (n: number) => string;
  empty?: string;
}) {
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  if (labels.length === 0 || max === 0)
    return <p className="rounded-lg bg-ivory px-3 py-10 text-center text-sm">{empty}</p>;
  const ticks = [max, max / 2, 0];
  const every = Math.max(1, Math.ceil(labels.length / 8));
  return (
    <figure>
      <div className="flex gap-2">
        <div
          className="flex h-44 flex-col justify-between text-right text-[10px] text-slate-text"
          aria-hidden
        >
          {ticks.map((t, i) => (
            <span key={i}>{format(Math.round(t))}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div aria-hidden className="flex h-44 items-end gap-[2px] border-b border-border">
            {labels.map((l, i) => (
              <div
                key={l + i}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]"
              >
                {series.map((s) => {
                  const v = s.values[i] ?? 0;
                  return (
                    <div
                      key={s.name}
                      title={`${l} · ${s.name}: ${format(v)}`}
                      className="w-full max-w-6 rounded-t transition-opacity hover:opacity-80"
                      style={{
                        height: `${(v / max) * 100}%`,
                        minHeight: v ? 2 : 0,
                        background: s.color,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div aria-hidden className="mt-1 flex gap-[2px] px-2 text-[10px] text-slate-text">
            {labels.map((l, i) => (
              <span
                key={l + i}
                className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center"
              >
                {i % every === 0 ? l : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <TableView
        caption={caption}
        head={['Interval', ...series.map((s) => s.name)]}
        rows={labels.map((l, i) => [l, ...series.map((s) => format(s.values[i] ?? 0))])}
      />
    </figure>
  );
}

/** Donut for mutually exclusive shares of one total. The total sits in the middle. */
export function Donut({
  caption,
  segments,
  centerLabel,
}: {
  caption: string;
  segments: { label: string; value: number; color: string }[];
  centerLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 15.915; // circumference 100
  let offset = 25;
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <figure className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 42 42" className="size-full" role="img" aria-label={caption}>
          <circle cx="21" cy="21" r={r} fill="none" stroke="#F6F0E7" strokeWidth="6" />
          {total
            ? shown.map((s) => {
                const len = pct(s.value);
                const gap = shown.length > 1 ? 0.6 : 0;
                const el = (
                  <circle
                    key={s.label}
                    cx="21"
                    cy="21"
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="6"
                    strokeDasharray={`${Math.max(0, len - gap)} ${100 - Math.max(0, len - gap)}`}
                    strokeDashoffset={offset}
                    className="transition-opacity hover:opacity-80"
                  >
                    <title>{`${s.label}: ${nf(s.value)} (${len.toFixed(1)}%)`}</title>
                  </circle>
                );
                offset -= len;
                return el;
              })
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl text-heading">{nf(total)}</span>
          <span className="text-xs">{centerLabel}</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="tabular-nums text-heading">
              {nf(s.value)}{' '}
              <span className="text-xs text-slate-text">({pct(s.value).toFixed(1)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Horizontal progress bars for shares (adoption, document types). */
export function ProgressBars({
  rows,
  empty = 'No activity was recorded for the selected period.',
}: {
  rows: { label: string; value: number; detail: string; href?: string }[];
  empty?: string;
}) {
  if (rows.length === 0)
    return <p className="rounded-lg bg-ivory px-3 py-8 text-center text-sm">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3 text-sm"
          title={r.detail}
        >
          <span className="truncate">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-cream" aria-hidden>
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, r.value))}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-heading">
            {r.value.toFixed(1)}%<span className="sr-only">, {r.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Panel({
  title,
  info,
  action,
  children,
  className,
}: {
  title: string;
  info?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-border bg-white p-5 shadow-card',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-display text-lg text-heading">
          {title}
          {info ? (
            <span className="ml-1 cursor-help text-xs font-sans text-slate-text" title={info}>
              ⓘ<span className="sr-only">{info}</span>
            </span>
          ) : null}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}
