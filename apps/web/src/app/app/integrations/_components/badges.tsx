import {
  CircleCheck,
  CircleDashed,
  Clock,
  KeyRound,
  Plug,
  TriangleAlert,
  Unplug,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/** App tile. Shows the official logo when one is in the catalogue, otherwise the app's initials. */
export function AppLogo({
  name,
  logo,
  size = 'md',
}: {
  name: string;
  logo: string | null;
  size?: 'md' | 'lg';
}) {
  const dim = size === 'lg' ? 'size-14 text-lg' : 'size-11 text-sm';
  if (logo)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        className={cn(dim, 'rounded-xl border border-border bg-white object-contain p-1.5')}
      />
    );
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        dim,
        'inline-flex shrink-0 items-center justify-center rounded-xl bg-navy font-display font-semibold text-gold',
      )}
    >
      {initials}
    </span>
  );
}

const pill = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold';

/** Availability: whether the marketplace offers the app at all. Icon + text, never colour alone. */
export function AvailabilityBadge({ availability }: { availability: string }) {
  switch (availability) {
    case 'available':
      return null;
    case 'beta':
      return (
        <span className={cn(pill, 'bg-info-bg text-info')}>
          <CircleDashed className="size-3" aria-hidden />
          Beta
        </span>
      );
    case 'maintenance':
      return (
        <span className={cn(pill, 'bg-warning-bg text-warning')}>
          <Wrench className="size-3" aria-hidden />
          Maintenance
        </span>
      );
    case 'unavailable':
      return (
        <span className={cn(pill, 'bg-cream text-slate-text')}>
          <Unplug className="size-3" aria-hidden />
          Unavailable
        </span>
      );
    default:
      return (
        <span className={cn(pill, 'bg-soft-gold text-navy')}>
          <Clock className="size-3" aria-hidden />
          Coming Soon
        </span>
      );
  }
}

export const CONNECTION_LABEL: Record<string, string> = {
  not_connected: 'Not Connected',
  connecting: 'Connecting',
  active: 'Connected',
  expired: 'Connection Expired',
  permission_required: 'Permission Required',
  error: 'Error',
  disabled: 'Disconnected',
};

/** One connection's state, separate from availability. */
export function ConnectionBadge({ status }: { status: string }) {
  const label = CONNECTION_LABEL[status] ?? status;
  if (status === 'active')
    return (
      <span className={cn(pill, 'bg-success-bg text-success')}>
        <CircleCheck className="size-3" aria-hidden />
        {label}
      </span>
    );
  if (status === 'expired' || status === 'permission_required')
    return (
      <span className={cn(pill, 'bg-warning-bg text-warning')}>
        <KeyRound className="size-3" aria-hidden />
        {label}
      </span>
    );
  if (status === 'error')
    return (
      <span className={cn(pill, 'bg-error-bg text-error')}>
        <TriangleAlert className="size-3" aria-hidden />
        {label}
      </span>
    );
  return (
    <span className={cn(pill, 'bg-primary-surface text-primary')}>
      <Plug className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(d),
      )
    : 'Not yet';
