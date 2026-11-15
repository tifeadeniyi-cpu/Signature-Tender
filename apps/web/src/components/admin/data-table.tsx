'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type Cell = string | number | null;
export interface Column {
  key: string;
  label: string;
  /** Right-aligned and sorted as a number. */
  numeric?: boolean;
  /** How to show the value; sorting still uses the raw value. */
  format?: 'percent' | 'number';
}

const show = (v: Cell, c: Column) => {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (c.format === 'percent') return `${v.toFixed(1)}%`;
    return v.toLocaleString('en-US');
  }
  return v;
};

/**
 * A report table: sortable columns, an optional search box and pagination, all in the browser
 * over rows the server already aggregated. Rows hold counts and labels only.
 */
export function DataTable({
  caption,
  columns,
  rows,
  searchable = false,
  pageSize = 12,
}: {
  caption: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  searchable?: boolean;
  pageSize?: number;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = needle
      ? rows.filter((row) =>
          Object.values(row).some((v) =>
            String(v ?? '')
              .toLowerCase()
              .includes(needle),
          ),
        )
      : rows;
    if (sort) {
      r = [...r].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (x == null) return 1;
        if (y == null) return -1;
        return (
          (typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y))) * sort.dir
        );
      });
    }
    return r;
  }, [rows, q, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * pageSize, current * pageSize + pageSize);

  if (rows.length === 0)
    return (
      <p className="rounded-lg bg-ivory px-3 py-8 text-center text-sm">
        No activity was recorded for the selected period.
      </p>
    );

  return (
    <div className="flex flex-col gap-2">
      {searchable ? (
        <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-heading">
          Search {caption.toLowerCase()}
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            className="h-9 rounded-lg border border-border bg-white px-3 text-sm"
          />
        </label>
      ) : null}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full min-w-[560px] text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-xs text-slate-text">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const Icon = active ? (sort!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}
                    className={`py-2 pr-3 font-semibold ${c.numeric ? 'text-right' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort(
                          active && sort!.dir === -1
                            ? { key: c.key, dir: 1 }
                            : { key: c.key, dir: -1 },
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-heading"
                    >
                      {c.label}
                      <Icon className="size-3" aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {slice.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`py-2 pr-3 tabular-nums ${c.numeric ? 'text-right' : ''}`}
                  >
                    {show(r[c.key] ?? null, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav
          aria-label={`${caption} pages`}
          className="flex items-center justify-end gap-2 text-xs"
        >
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <button
            type="button"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
            className="rounded-md border border-border px-2 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}
