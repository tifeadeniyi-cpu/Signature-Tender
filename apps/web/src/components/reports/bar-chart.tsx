/**
 * Single-series column chart. One hue (no legend needed; the heading names the series), 4px
 * rounded tops on a shared baseline, 2px gaps, recessive axis, a native tooltip on every
 * column, and a table view so nothing depends on seeing the bars.
 */
export function BarChart({
  title,
  data,
  unit,
  empty = 'No data in this range.',
}: {
  title: string;
  data: { label: string; value: number }[];
  unit: string;
  empty?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-heading">{title}</span>
        <span className="text-xs">
          {total.toLocaleString('en-US')} {unit}
        </span>
      </figcaption>
      {data.length === 0 || total === 0 ? (
        <p className="rounded-lg bg-blush/50 px-3 py-8 text-center text-sm">{empty}</p>
      ) : (
        <div aria-hidden className="flex h-40 items-end gap-0.5 border-b border-border">
          {data.map((d) => (
            <div
              key={d.label}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${d.label}: ${d.value.toLocaleString('en-US')} ${unit}`}
            >
              <div
                className="rounded-t bg-primary transition-opacity group-hover:opacity-80"
                style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }}
              />
            </div>
          ))}
        </div>
      )}
      {data.length > 0 && total > 0 ? (
        <div aria-hidden className="flex justify-between text-[11px] text-slate-500">
          <span>{data[0]!.label}</span>
          {data.length > 1 ? <span>{data.at(-1)!.label}</span> : null}
        </div>
      ) : null}
      {data.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-primary">Show as table</summary>
          <table className="mt-2 w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1 font-semibold">
                  Period
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  {unit}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label} className="border-b border-border/60">
                  <td className="py-1">{d.label}</td>
                  <td className="py-1 text-right tabular-nums">
                    {d.value.toLocaleString('en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </figure>
  );
}

/** Horizontal bars for ranked categories, labelled directly with their values. */
export function RankList({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: { label: string; value: number; note?: string }[];
  unit: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-semibold text-heading">{title}</figcaption>
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate text-heading">{r.label}</span>
                <span className="shrink-0 tabular-nums">
                  {r.value.toLocaleString('en-US')} {unit}
                  {r.note ? <span className="text-xs text-slate-500"> · {r.note}</span> : null}
                </span>
              </div>
              <div aria-hidden className="mt-1 h-1.5 rounded-full bg-blush">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(r.value / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">No data in this range.</p>
      )}
    </figure>
  );
}
