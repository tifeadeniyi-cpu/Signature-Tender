'use client';
import { useRef, useState } from 'react';
import { COMPARES, COMPARE_LABEL, RANGES, RANGE_LABEL } from '@st/core/period';

/**
 * Date range and comparison controls. A plain GET form, so the filter lives in the URL and can
 * be shared; it submits on change. Extra params (such as the current tab) are kept.
 */
export function PeriodFilter({
  action,
  range,
  compare,
  from,
  to,
  keep = {},
}: {
  action: string;
  range: string;
  compare: string;
  from?: string;
  to?: string;
  keep?: Record<string, string>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [r, setR] = useState(range);
  const submit = () => form.current?.requestSubmit();
  const select = 'h-10 rounded-lg border border-border bg-white px-3 text-sm text-heading';
  return (
    <form
      ref={form}
      method="get"
      action={action}
      className="flex flex-wrap items-end gap-2"
      aria-label="Report period"
    >
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="flex flex-col gap-1 text-xs font-medium text-heading">
        Date range
        <select
          name="range"
          value={r}
          onChange={(e) => {
            setR(e.target.value);
            if (e.target.value !== 'custom') queueMicrotask(submit);
          }}
          className={select}
        >
          {RANGES.map((k) => (
            <option key={k} value={k}>
              {RANGE_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {r === 'custom' ? (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-heading">
            From
            <input type="date" name="from" defaultValue={from} required className={select} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-heading">
            To
            <input type="date" name="to" defaultValue={to} required className={select} />
          </label>
        </>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-heading">
        Compare to
        <select name="compare" defaultValue={compare} onChange={submit} className={select}>
          {COMPARES.map((k) => (
            <option key={k} value={k}>
              {COMPARE_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button
          type="submit"
          className="h-10 rounded-lg bg-gold px-3 text-sm font-semibold text-heading"
        >
          Apply
        </button>
      </noscript>
      {r === 'custom' ? (
        <button
          type="submit"
          className="h-10 rounded-lg bg-gold px-3 text-sm font-semibold text-heading"
        >
          Apply
        </button>
      ) : null}
    </form>
  );
}
