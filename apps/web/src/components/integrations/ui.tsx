import {
  CircleCheck,
  CircleDashed,
  CircleAlert,
  Clock,
  Wrench,
  Ban,
  Sparkles,
  Plug,
  Unplug,
  Loader,
} from 'lucide-react';
import type { IntegrationAvailability, IntegrationConnectionState } from '@st/core';
import { cn } from '@/lib/cn';

/**
 * A neutral monogram tile. Provider logos are only shown from licensed brand assets added to
 * /public/integrations; until then, the app's initials stand in rather than a redrawn logo.
 */
export function AppMark({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const initials = name
    .replace(/^Microsoft\s+/, '')
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl border border-gold/40 bg-navy font-display font-semibold text-gold',
        size === 'lg' ? 'size-14 text-xl' : 'size-11 text-base',
      )}
    >
      {initials}
    </span>
  );
}

const AVAIL: Record<IntegrationAvailability, { label: string; cls: string; Icon: typeof Clock }> = {
  available: { label: 'Available', cls: 'bg-success-bg text-success', Icon: CircleCheck },
  beta: { label: 'Beta', cls: 'bg-soft-gold text-navy', Icon: Sparkles },
  coming_soon: { label: 'Coming Soon', cls: 'bg-cream text-slate-text', Icon: Clock },
  unavailable: { label: 'Unavailable', cls: 'bg-cream text-slate-text', Icon: Ban },
  maintenance: { label: 'Maintenance', cls: 'bg-warning-bg text-warning', Icon: Wrench },
};

export function AvailabilityBadge({ value }: { value: IntegrationAvailability }) {
  const a = AVAIL[value];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        a.cls,
      )}
    >
      <a.Icon className="size-3.5" aria-hidden />
      {a.label}
    </span>
  );
}

export const CONNECTION_LABEL: Record<IntegrationConnectionState, string> = {
  not_connected: 'Not Connected',
  connecting: 'Connecting',
  connected: 'Connected',
  expired: 'Connection Expired',
  error: 'Error',
  disconnected: 'Disconnected',
};

const CONN: Record<IntegrationConnectionState, { cls: string; Icon: typeof Clock }> = {
  not_connected: { cls: 'text-slate-text', Icon: CircleDashed },
  connecting: { cls: 'text-info', Icon: Loader },
  connected: { cls: 'text-success', Icon: Plug },
  expired: { cls: 'text-warning', Icon: CircleAlert },
  error: { cls: 'text-error', Icon: CircleAlert },
  disconnected: { cls: 'text-slate-text', Icon: Unplug },
};

export function ConnectionStatus({ value }: { value: IntegrationConnectionState }) {
  const c = CONN[value];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', c.cls)}>
      <c.Icon className="size-3.5" aria-hidden />
      {CONNECTION_LABEL[value]}
    </span>
  );
}

export const OPERATION_LABEL: Record<string, string> = {
  connect: 'Connected account',
  import_document: 'Imported document',
  save_signed_copy: 'Saved signed copy',
};

export const JOB_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'error' | 'warning' | 'info' | 'neutral' }
> = {
  succeeded: { label: 'Success', tone: 'success' },
  pending: { label: 'Pending', tone: 'info' },
  running: { label: 'Pending', tone: 'info' },
  retrying: { label: 'Retrying', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
