'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X, Check, ShieldCheck, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, ButtonLink, buttonClass } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import type { MarketplaceItem, Permissions } from '@/lib/integrations-view';
import { AppLogo, AvailabilityBadge, ConnectionBadge } from './badges';
import { ConnectForm, DisconnectForm } from '../connect-forms';
import { TestConnectionForm } from './connection-forms';

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

function matches(i: MarketplaceItem, q: string) {
  if (!q) return true;
  const hay = [i.name, i.provider, i.category, i.description, ...i.capabilities]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function syncUrl(app: string | null) {
  const url = new URL(window.location.href);
  if (app) url.searchParams.set('app', app);
  else url.searchParams.delete('app');
  url.searchParams.delete('connected');
  url.searchParams.delete('error');
  url.searchParams.delete('provider');
  window.history.replaceState(window.history.state, '', url);
}

export function Marketplace({
  items,
  perms,
  initialApp,
}: {
  items: MarketplaceItem[];
  perms: Permissions;
  initialApp: string | null;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]>('All Integrations');
  const [open, setOpen] = useState<string | null>(
    initialApp && items.some((i) => i.key === initialApp) ? initialApp : null,
  );
  const opener = useRef<HTMLElement | null>(null);

  const shown = useMemo(
    () =>
      items
        .filter((i) =>
          tab === 'All Integrations'
            ? true
            : tab === 'Connected'
              ? i.connections.length > 0
              : i.category === tab,
        )
        .filter((i) => matches(i, q))
        // Working apps first, then the roadmap in phase order.
        .sort(
          (a, b) =>
            Number(b.implemented) - Number(a.implemented) ||
            (a.roadmapPhase || 0) - (b.roadmapPhase || 0) ||
            a.name.localeCompare(b.name),
        ),
    [items, q, tab],
  );
  const selected = items.find((i) => i.key === open) ?? null;

  return (
    <>
      <div className="mb-4">
        <label htmlFor="integration-search" className="sr-only">
          Search apps and integrations
        </label>
        <div className="relative max-w-xl">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-text"
            aria-hidden
          />
          <input
            id="integration-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search apps and integrations..."
            className="h-11 w-full rounded-xl border border-border bg-white pl-9 pr-3 text-sm text-heading shadow-card placeholder:text-slate-text/70"
          />
        </div>
      </div>

      <div role="group" aria-label="Categories" className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors',
              tab === t
                ? 'border-navy bg-navy font-semibold text-white'
                : 'border-border bg-white text-heading hover:border-gold',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {shown.length} {shown.length === 1 ? 'integration' : 'integrations'} shown
      </p>

      {shown.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="No integrations match">
          {tab === 'Connected'
            ? 'No apps are connected yet. Browse the catalogue and connect one that is available.'
            : 'Try another search or category.'}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((i) => (
            <li key={i.key}>
              <Card
                item={i}
                onOpen={(el) => {
                  opener.current = el;
                  setOpen(i.key);
                  syncUrl(i.key);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-sm">
        Building your own connection? Use the{' '}
        <Link href="/app/settings/developers" className="font-semibold text-primary underline">
          Developer settings
        </Link>{' '}
        for API keys and webhooks.
      </p>

      {selected ? (
        <DetailsDrawer
          item={selected}
          perms={perms}
          onClose={() => {
            setOpen(null);
            syncUrl(null);
            requestAnimationFrame(() => opener.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}

function actionLabel(i: MarketplaceItem) {
  if (!i.implemented) return 'Coming Soon';
  if (i.connections.length) return 'Manage';
  if (i.connectable) return 'Connect';
  return 'View details';
}

function Card({ item: i, onOpen }: { item: MarketplaceItem; onOpen: (el: HTMLElement) => void }) {
  const titleId = useId();
  const label = actionLabel(i);
  return (
    <article
      aria-labelledby={titleId}
      className="flex h-full flex-col rounded-2xl border border-border bg-white p-5 shadow-card transition-shadow hover:shadow-lg"
    >
      <div className="mb-3 flex items-start gap-3">
        <AppLogo name={i.name} logo={i.logo} />
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="font-display text-lg leading-tight">
            {i.name}
          </h3>
          <p className="text-xs">{i.category}</p>
        </div>
      </div>
      <p className="mb-4 line-clamp-3 flex-1 text-sm">{i.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <AvailabilityBadge availability={i.availability} />
          {i.implemented ? <ConnectionBadge status={i.status} /> : null}
        </div>
        <button
          type="button"
          onClick={(e) => onOpen(e.currentTarget)}
          aria-label={`${label}: ${i.name}`}
          className={buttonClass(
            label === 'Connect' ? 'primary' : label === 'Coming Soon' ? 'secondary' : 'secondary',
            'sm',
          )}
        >
          {label}
        </button>
      </div>
    </article>
  );
}

function DetailsDrawer({
  item: i,
  perms,
  onClose,
}: {
  item: MarketplaceItem;
  perms: Permissions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 ml-auto h-full max-h-none w-full max-w-none bg-ivory p-0 backdrop:bg-navy/40 sm:max-w-lg"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start gap-3 border-b border-border bg-white p-5">
          <AppLogo name={i.name} logo={i.logo} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-2xl leading-tight">
              {i.name}
            </h2>
            <p className="text-sm">
              {i.provider} · {i.category}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <AvailabilityBadge availability={i.availability} />
              {i.implemented ? <ConnectionBadge status={i.status} /> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-heading hover:bg-cream"
            aria-label="Close details"
            autoFocus
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <p className="text-sm">{i.description}</p>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-heading">
              {i.implemented ? 'What it can do' : 'Planned features'}
            </h3>
            <ul className="grid gap-1.5 text-sm">
              {i.capabilities.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <Check className="size-4 text-gold" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-white p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-heading">
              <ShieldCheck className="size-4 text-gold" aria-hidden />
              Access and data sharing
            </h3>
            {i.access.reads.length ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide">Reads</p>
                <ul className="mb-2 list-disc pl-5 text-sm">
                  {i.access.reads.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {i.access.writes.length ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide">Writes</p>
                <ul className="mb-2 list-disc pl-5 text-sm">
                  {i.access.writes.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="text-sm">
              {i.access.copiesSignedDocuments
                ? 'Signed documents are copied to the app only when you turn that on. Anyone with access to the destination in that app can then see them.'
                : 'Signed documents are not copied to this app.'}
            </p>
            {i.access.revoke ? <p className="mt-2 text-sm">{i.access.revoke}</p> : null}
            <p className="mt-2 text-xs">
              Signature Tender keeps the signing record and evidence whatever you connect or
              disconnect.
            </p>
          </section>

          {i.setup.length ? (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-heading">How to set it up</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {i.setup.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </section>
          ) : null}

          <DrawerActions item={i} perms={perms} />
        </div>
      </div>
    </dialog>
  );
}

function DrawerActions({ item: i, perms }: { item: MarketplaceItem; perms: Permissions }) {
  const [agreed, setAgreed] = useState(false);
  const [visibility, setVisibility] = useState<'workspace' | 'personal'>(
    perms.manage ? 'workspace' : 'personal',
  );
  const consentId = useId();

  if (!i.implemented)
    return (
      <section className="rounded-xl bg-cream p-4">
        <Button type="button" variant="secondary" disabled aria-disabled>
          Coming Soon
        </Button>
        <p className="mt-2 text-sm">
          {i.name} is on our roadmap and cannot be connected yet. Nothing is sent to it.
        </p>
      </section>
    );

  // Partner apps and Slack: the API key or webhook flow.
  if (i.authType === 'partner_api_key' || i.authType === 'slack_webhook') {
    const connected = i.connections.length > 0;
    if (!(perms.manage && perms.apiManage))
      return (
        <Alert tone="info">
          Only owners, admins and API developers can connect or disconnect {i.name}.
        </Alert>
      );
    return (
      <section className="space-y-3">
        <ConnectForm
          provider={i.key}
          name={i.name}
          connected={connected}
          kind={i.authType === 'slack_webhook' ? 'slack' : 'api'}
        />
        {connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              href="/app/integrations/connected"
              className="text-sm font-semibold text-primary underline"
            >
              Manage connection
            </Link>
            <DisconnectForm provider={i.key} name={i.name} />
          </div>
        ) : null}
      </section>
    );
  }

  if (i.authType !== 'oauth2')
    return (
      <Alert tone="info">
        {i.name} is set up from {i.provider}, not from here.
      </Alert>
    );

  return (
    <section className="space-y-4">
      {i.connections.length ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-heading">Your connections</h3>
          <ul className="space-y-2">
            {i.connections.map((c) => (
              <li key={c.id} className="rounded-xl border border-border bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-heading">{c.label}</p>
                    <p className="text-xs">
                      {c.visibility === 'personal' ? 'Personal' : 'Shared with the workspace'}
                    </p>
                  </div>
                  <ConnectionBadge status={c.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.id ? <TestConnectionForm id={c.id} /> : null}
                  {c.status !== 'active' && (perms.manage || c.mine) ? (
                    <a
                      href={`/api/integrations/oauth/${i.key}/start?visibility=${c.visibility}`}
                      className={buttonClass('primary', 'sm')}
                    >
                      Reconnect
                    </a>
                  ) : null}
                  <ButtonLink href="/app/integrations/connected" variant="ghost" size="sm">
                    Manage
                  </ButtonLink>
                  <ButtonLink
                    href={`/app/integrations/activity?provider=${i.key}`}
                    variant="ghost"
                    size="sm"
                  >
                    View activity
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!i.connectable ? (
        <Alert tone="info">
          {i.reason === 'setup_required'
            ? perms.manage
              ? `${i.name} is built but its app credentials are not configured on this server yet.`
              : `${i.name} is not available yet.`
            : `${i.name} cannot be connected right now.`}
        </Alert>
      ) : perms.manage || (perms.use && i.allowsPersonal) ? (
        <div className="rounded-xl border border-border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-heading">
            {i.connections.length ? 'Connect another account' : `Connect ${i.name}`}
          </h3>
          {perms.manage && i.allowsPersonal ? (
            <fieldset className="mb-3 space-y-1 text-sm">
              <legend className="sr-only">Who can use this connection</legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="vis"
                  checked={visibility === 'workspace'}
                  onChange={() => setVisibility('workspace')}
                />
                Share with the workspace
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="vis"
                  checked={visibility === 'personal'}
                  onChange={() => setVisibility('personal')}
                />
                Just for me
              </label>
            </fieldset>
          ) : null}
          <label htmlFor={consentId} className="mb-3 flex items-start gap-2 text-sm">
            <input
              id={consentId}
              type="checkbox"
              className="mt-1"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            I have read what {i.name} can access and want to connect it. I can disconnect at any
            time.
          </label>
          {agreed ? (
            <a
              href={`/api/integrations/oauth/${i.key}/start?visibility=${visibility}`}
              className={buttonClass('primary', 'md')}
            >
              Continue to {i.provider}
              <ExternalLink className="size-4" aria-hidden />
            </a>
          ) : (
            <Button type="button" disabled aria-disabled>
              Continue to {i.provider}
            </Button>
          )}
        </div>
      ) : (
        <Alert tone="info">
          Your role does not allow connecting apps. Ask a workspace owner or admin.
        </Alert>
      )}
    </section>
  );
}
