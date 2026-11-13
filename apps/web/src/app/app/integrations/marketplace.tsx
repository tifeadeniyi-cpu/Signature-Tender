'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  INTEGRATION_CAPABILITIES,
  searchIntegrations,
  type IntegrationAvailability,
  type IntegrationConnectionState,
  type IntegrationInfo,
} from '@st/core/integration-catalog';
import { buttonClass } from '@/components/ui/button';
import { AppMark, AvailabilityBadge, ConnectionStatus } from '@/components/integrations/ui';
import { cn } from '@/lib/cn';

export interface MarketplaceItem {
  info: IntegrationInfo;
  availability: IntegrationAvailability;
  connection: IntegrationConnectionState;
}

const TABS = [
  'All Integrations',
  'Connected',
  'Automation',
  'CRM & Sales',
  'Documents & Storage',
  'Productivity',
  'Forms',
  'E-Commerce',
  'HR & Business',
  'Communication',
  'Partner apps',
] as const;

const usable = (a: IntegrationAvailability) => a === 'available' || a === 'beta';
const live = (c: IntegrationConnectionState) =>
  c === 'connected' || c === 'expired' || c === 'error';

export function Marketplace({
  items,
  canManage,
}: {
  items: MarketplaceItem[];
  canManage: boolean;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]>('All Integrations');
  const shown = useMemo(() => {
    const byCat = tab === 'All Integrations' || tab === 'Connected' ? undefined : (tab as string);
    const keys = new Set(
      searchIntegrations(
        items.map((i) => i.info),
        q,
        byCat,
      ).map((i) => i.key),
    );
    return items
      .filter((i) => keys.has(i.info.key) && (tab !== 'Connected' || live(i.connection)))
      .sort(
        (a, b) =>
          Number(live(b.connection)) - Number(live(a.connection)) ||
          Number(usable(b.availability)) - Number(usable(a.availability)) ||
          (a.info.phase ?? 0) - (b.info.phase ?? 0),
      );
  }, [items, q, tab]);

  return (
    <div>
      <div className="mb-4">
        <label htmlFor="int-search" className="sr-only">
          Search apps and integrations
        </label>
        <div className="relative max-w-xl">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-text"
            aria-hidden
          />
          <input
            id="int-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search apps and integrations..."
            className="h-11 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-heading placeholder:text-slate-text"
          />
        </div>
      </div>
      <div role="tablist" aria-label="Categories" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm',
              tab === t
                ? 'border-navy bg-navy font-semibold text-ivory'
                : 'border-border bg-white text-heading hover:border-gold',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {shown.length} {shown.length === 1 ? 'integration' : 'integrations'} shown
      </p>
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center text-sm">
          {tab === 'Connected'
            ? 'No apps are connected yet. Connect one from All Integrations.'
            : tab === 'HR & Business' && !q
              ? 'No HR and business apps yet. Tell us which ones you use.'
              : 'No integrations match your search.'}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(({ info, availability, connection }) => {
            const href = `/app/integrations/${info.key}`;
            return (
              <li
                key={info.key}
                className="relative flex flex-col rounded-2xl border border-border bg-white p-5 shadow-card transition hover:border-gold/70"
              >
                <div className="mb-3 flex items-start gap-3">
                  <AppMark name={info.name} />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg leading-tight">
                      <Link
                        href={href}
                        className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none"
                      >
                        {info.name}
                      </Link>
                    </h3>
                    <p className="text-xs">{info.category}</p>
                  </div>
                  <AvailabilityBadge value={availability} />
                </div>
                <p className="mb-4 line-clamp-3 flex-1 text-sm">{info.description}</p>
                {info.capabilities.length ? (
                  <p className="mb-4 text-xs text-slate-text">
                    {info.capabilities
                      .slice(0, 3)
                      .map((c) => INTEGRATION_CAPABILITIES[c])
                      .join(' · ')}
                  </p>
                ) : null}
                <div className="relative z-10 flex items-center justify-between gap-2 border-t border-border pt-3">
                  <ConnectionStatus value={connection} />
                  {live(connection) ? (
                    <Link
                      href={href}
                      className={buttonClass('secondary', 'sm')}
                      aria-label={`Manage ${info.name}`}
                    >
                      Manage
                    </Link>
                  ) : usable(availability) && canManage ? (
                    <Link
                      href={info.kind === 'oauth' ? `/api/integrations/${info.key}/connect` : href}
                      prefetch={false}
                      className={buttonClass('gold', 'sm')}
                      aria-label={`Connect ${info.name}`}
                    >
                      Connect
                    </Link>
                  ) : usable(availability) ? (
                    <Link href={href} className={buttonClass('ghost', 'sm')}>
                      Details
                    </Link>
                  ) : (
                    <span className="text-xs font-semibold text-slate-text">
                      {availability === 'coming_soon'
                        ? 'Coming Soon'
                        : availability === 'maintenance'
                          ? 'Under maintenance'
                          : 'Not available'}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
