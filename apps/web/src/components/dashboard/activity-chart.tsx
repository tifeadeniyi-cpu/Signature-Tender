'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ActivityPoint {
  day: string;
  sent: number;
  completed: number;
}

/** Royal Navy and a deeper Champagne Gold: validated for colour-blind separation and 3:1 contrast. */
const SERIES = [
  { key: 'sent', label: 'Documents Sent', color: '#172D4D' },
  { key: 'completed', label: 'Documents Completed', color: '#A87B2E' },
] as const;

const H = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 36 };

const fmtDay = (d: string, long = false) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(long ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => v / s <= 4)!;
  return Math.ceil(v / step) * step;
}

/** Two-series line chart of real daily counts, with a crosshair tooltip and a table for screen readers. */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = useMemo(
    () => ({
      sent: data.reduce((s, d) => s + d.sent, 0),
      completed: data.reduce((s, d) => s + d.completed, 0),
    }),
    [data],
  );
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.sent, d.completed))));
  const iw = w - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 70))));

  const path = (k: 'sent' | 'completed') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(' ');

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - PAD.left;
    const i = Math.round((px / iw) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(data.length - 1, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? data.length) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const summary = `${totals.sent} documents sent and ${totals.completed} completed between ${fmtDay(data[0]!.day, true)} and ${fmtDay(data[data.length - 1]!.day, true)}.`;
  const h = hover !== null ? data[hover] : null;

  return (
    <figure className="m-0 min-w-0">
      <ul className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="inline-block h-0.5 w-5 rounded"
              style={{ backgroundColor: s.color, height: 3 }}
              aria-hidden
            />
            <span className="text-slate-text">{s.label}</span>
            <span className="font-semibold text-dark-text tabular-nums">{totals[s.key]}</span>
          </li>
        ))}
      </ul>
      <div ref={wrap} className="relative w-full min-w-0 overflow-hidden">
        <svg
          width={w}
          height={H}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          <title
            id={titleId}
          >{`Activity chart. ${summary} Use the left and right arrow keys to read each day.`}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={w - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="#E7E1D6"
                strokeWidth={1}
              />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#475569">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const last = i === data.length - 1;
            // Regular ticks, plus the last day unless it would crowd the tick before it.
            const show =
              (i % labelEvery === 0 &&
                !(!last && data.length - 1 - i < labelEvery / 2 && i !== 0)) ||
              last;
            if (!show) return null;
            const anchor = i === 0 ? 'start' : last ? 'end' : 'middle';
            return (
              <text key={d.day} x={x(i)} y={H - 8} textAnchor={anchor} fontSize={11} fill="#475569">
                {fmtDay(d.day)}
              </text>
            );
          })}
          {SERIES.map((s) => (
            <path
              key={s.key}
              d={path(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover !== null ? (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + ih}
                stroke="#94A3B8"
                strokeDasharray="3 3"
              />
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(data[hover]![s.key])}
                  r={5}
                  fill={s.color}
                  stroke="#fff"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
        </svg>
        {h && hover !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-card"
            style={{
              left: Math.min(Math.max(x(hover) - 80, 0), w - 170),
              width: 160,
            }}
          >
            <p className="font-semibold text-dark-text">{fmtDay(h.day, true)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="mt-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden
                  />
                  {s.label.replace('Documents ', '')}
                </span>
                <span className="font-semibold text-dark-text tabular-nums">{h[s.key]}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
      <table className="sr-only">
        <caption>Documents sent and completed per day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Sent</th>
            <th scope="col">Completed</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{fmtDay(d.day, true)}</th>
              <td>{d.sent}</td>
              <td>{d.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
