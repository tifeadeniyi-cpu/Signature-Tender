/**
 * Report periods for the founder admin analytics. Pure and dependency-free so the browser filter
 * controls can import it. The reporting time zone is UTC, so day and month boundaries never
 * double count.
 */
export const RANGES = [
  'today',
  'yesterday',
  '7d',
  '30d',
  '90d',
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'custom',
] as const;
export type RangeKey = (typeof RANGES)[number];
export const COMPARES = ['previous', 'prev_month', 'prev_quarter', 'prev_year', 'none'] as const;
export type CompareKey = (typeof COMPARES)[number];
export type Bucket = 'day' | 'week' | 'month';

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom dates',
};
export const COMPARE_LABEL: Record<CompareKey, string> = {
  previous: 'Previous period',
  prev_month: 'Previous month',
  prev_quarter: 'Previous quarter',
  prev_year: 'Previous year',
  none: 'No comparison',
};

export interface Period {
  range: RangeKey;
  compare: CompareKey;
  from: Date;
  /** Exclusive end. */
  to: Date;
  cmpFrom: Date | null;
  cmpTo: Date | null;
  bucket: Bucket;
}

const DAY = 86_400_000;
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addMonths = (d: Date, n: number) =>
  new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + n,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
    ),
  );
const parseDay = (s: string | undefined | null) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;

/** Turns the filter controls into exact UTC bounds. Unknown values fall back to the defaults. */
export function resolvePeriod(
  input: {
    range?: string | null;
    compare?: string | null;
    from?: string | null;
    to?: string | null;
  },
  now = new Date(),
): Period {
  let range = (RANGES as readonly string[]).includes(input.range ?? '')
    ? (input.range as RangeKey)
    : '30d';
  const compare = (COMPARES as readonly string[]).includes(input.compare ?? '')
    ? (input.compare as CompareKey)
    : 'previous';
  const today = utcDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  let from: Date;
  let to: Date = tomorrow;
  switch (range) {
    case 'today':
      from = today;
      break;
    case 'yesterday':
      from = new Date(today.getTime() - DAY);
      to = today;
      break;
    case '7d':
      from = new Date(tomorrow.getTime() - 7 * DAY);
      break;
    case '90d':
      from = new Date(tomorrow.getTime() - 90 * DAY);
      break;
    case 'this_month':
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case 'last_month':
      to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      break;
    case 'this_quarter':
      from = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
      break;
    case 'this_year':
      from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      break;
    case 'custom': {
      const f = parseDay(input.from);
      const t = parseDay(input.to);
      if (f && t && f <= t && t.getTime() - f.getTime() <= 3 * 366 * DAY) {
        from = f;
        to = new Date(t.getTime() + DAY);
      } else {
        range = '30d';
        from = new Date(tomorrow.getTime() - 30 * DAY);
      }
      break;
    }
    default:
      from = new Date(tomorrow.getTime() - 30 * DAY);
  }
  const len = to.getTime() - from.getTime();
  let cmpFrom: Date | null = null;
  let cmpTo: Date | null = null;
  if (compare === 'previous') {
    cmpTo = from;
    cmpFrom = new Date(from.getTime() - len);
  } else if (compare !== 'none') {
    const months = compare === 'prev_month' ? 1 : compare === 'prev_quarter' ? 3 : 12;
    cmpFrom = addMonths(from, -months);
    cmpTo = addMonths(to, -months);
  }
  const days = len / DAY;
  const bucket: Bucket = days <= 31 ? 'day' : days <= 180 ? 'week' : 'month';
  return { range, compare, from, to, cmpFrom, cmpTo, bucket };
}

/** Percentage change, or null when there is no comparison or the baseline is zero. */
export function pctChange(current: number, previous: number | null | undefined): number | null {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Share as a percentage, or null when the denominator is zero. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}
