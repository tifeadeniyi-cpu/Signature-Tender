export type RangeKey = '7d' | '30d' | '90d' | 'year' | 'custom';

export const RANGE_OPTIONS: { key: Exclude<RangeKey, 'custom'>; label: string }[] = [
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '90d', label: 'Last 90 Days' },
  { key: 'year', label: 'This Year' },
];

export interface DashboardRange {
  key: RangeKey;
  from: string;
  to: string;
  label: string;
  /** "previous 30 days", used next to comparison figures. */
  compareLabel: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date (YYYY-MM-DD) in the member's own time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Reads ?range= (and ?from=&to= for a custom range) and falls back to the last 30 days. */
export function parseRange(
  sp: { range?: string; from?: string; to?: string },
  timeZone: string,
  now = new Date(),
): DashboardRange {
  const today = todayIn(timeZone, now);
  const span = (n: number) => ({ from: shift(today, -(n - 1)), to: today });
  const key =
    (['7d', '30d', '90d', 'year', 'custom'] as const).find((k) => k === sp.range) ?? '30d';
  if (key === 'custom' && sp.from && sp.to && DAY.test(sp.from) && DAY.test(sp.to)) {
    let [from, to] = sp.from <= sp.to ? [sp.from, sp.to] : [sp.to, sp.from];
    if (to > today) to = today;
    if (from > to) from = to;
    // Keep within two years, the limit the report query accepts.
    if (Date.parse(to) - Date.parse(from) > 730 * 86_400_000) from = shift(to, -730);
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    return { key, from, to, label: 'Custom range', compareLabel: `previous ${days} days` };
  }
  if (key === 'year') {
    const from = `${today.slice(0, 4)}-01-01`;
    return { key, from, to: today, label: 'This Year', compareLabel: 'same length before' };
  }
  const n = key === '7d' ? 7 : key === '90d' ? 90 : 30;
  const k = key === 'custom' ? '30d' : key;
  return {
    key: k,
    ...span(n),
    label: RANGE_OPTIONS.find((o) => o.key === k)!.label,
    compareLabel: `previous ${n} days`,
  };
}

/** "+33%", "-12%", "New" (nothing to compare with) or "No change". Never a division by zero. */
export function compare(
  current: number,
  previous: number,
): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (previous === 0)
    return current === 0 ? { text: 'No change', tone: 'flat' } : { text: 'New', tone: 'up' };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: 'No change', tone: 'flat' };
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, tone: pct > 0 ? 'up' : 'down' };
}
