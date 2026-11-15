import { Suspense, cache } from 'react';
import Link from 'next/link';
import {
  FileText,
  Send,
  CircleCheck,
  PenLine,
  Plus,
  PenTool,
  Layers,
  ArrowRight,
  ChevronRight,
  Check,
  Zap,
  ChartColumn,
  Signature,
  CalendarRange,
} from 'lucide-react';
import {
  formatMoney,
  getDashboardActivity,
  getProfile,
  hasPermission,
  searchLibrary,
  type DocumentStatus,
  type RequestStatus,
} from '@st/core';
import { emptyDesign } from '@st/core/studio/index';
import { StatusBadge } from '@/components/documents/status-badge';
import { DocumentDrawerHost } from '@/components/documents/drawer/document-drawer';
import { documentReference } from '@/lib/document-summary';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { RowMenu } from '@/components/dashboard/row-menu';
import { SectionError, Skeleton } from '@/components/dashboard/section-error';
import {
  RANGE_OPTIONS,
  compare,
  parseRange,
  type DashboardRange,
} from '@/components/dashboard/range';
import { requireWorkspace } from '@/lib/session';
import { db } from '@/lib/db';
import { cn } from '@/lib/cn';
import { designSvg, studioSettings } from '@/lib/studio';
import { libraryItems } from '@/lib/studio-library';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

type Params = { range?: string; from?: string; to?: string; selected?: string };

// One query per request, shared by the sections that need it.
const activityFor = cache((userId: string, ws: string, from: string, to: string, tz: string) =>
  getDashboardActivity(db(), { userId }, ws, { from, to }, { timeZone: tz }),
);
const signaturesFor = cache((userId: string) => libraryItems(userId));

const card = 'min-w-0 rounded-2xl border border-border bg-white p-5 shadow-card sm:p-6';
const goldBtn =
  'bg-gradient-to-b from-soft-gold to-gold text-primary hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const { user, membership } = await requireWorkspace();
  const ws = membership.workspace.id;
  const p = membership.permissions;
  const [profile, studio] = await Promise.all([
    getProfile(db(), { userId: user.id }).catch(() => null),
    studioSettings().catch(() => null),
  ]);
  const tz = profile?.timezone ?? 'UTC';
  const range = parseRange(sp, tz);
  const canDocs = hasPermission(p, 'documents.view_own') || hasPermission(p, 'documents.view_all');
  const canCreate = hasPermission(p, 'documents.create');
  const canTemplates = hasPermission(p, 'templates.view');
  const studioOn = Boolean(studio?.enabled);
  const price = studio ? formatMoney(studio.priceCents, studio.currency) : '';
  const ctx = { userId: user.id, ws, tz, range };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-heading">Dashboard</h1>
          <p className="mt-1 text-slate-text">
            Manage your documents, signatures, and transactions in one place.
          </p>
        </div>
        {canDocs ? <RangePicker range={range} /> : null}
      </header>

      {/* Row 1: KPIs and the two document actions */}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
        {canDocs ? (
          <Suspense fallback={<KpiSkeleton />}>
            <Kpis {...ctx} studioOn={studioOn} />
          </Suspense>
        ) : (
          <div className={card}>
            <p className="text-sm">
              Your role does not include viewing documents in this workspace.
            </p>
          </div>
        )}
        {canCreate ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 xl:content-start">
            <Link
              href="/app/documents/new"
              className={cn(
                'flex h-14 items-center justify-center gap-2 rounded-xl text-base font-semibold shadow-card',
                goldBtn,
              )}
            >
              <Plus className="size-5" aria-hidden /> Send Document
            </Link>
            <Link
              href="/app/documents/new?self=1"
              title="Upload a PDF and sign it yourself, for a flat fee per document"
              className="flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-primary/80 bg-white text-base font-semibold text-primary hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <PenLine className="size-5" aria-hidden /> Sign a Document
            </Link>
          </div>
        ) : null}
      </div>

      {/* Row 2: recent documents and quick actions */}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        {canDocs ? (
          <section className={card} aria-labelledby="recent-heading">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2
                id="recent-heading"
                className="flex items-center gap-2 font-display text-2xl text-heading"
              >
                <FileText className="size-5 text-gold" aria-hidden /> Recent Documents
              </h2>
              <Link
                href="/app/documents"
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                View All <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <Suspense fallback={<RowsSkeleton />}>
              <Recent
                userId={user.id}
                ws={ws}
                selected={sp.selected ?? null}
                canCreate={canCreate}
              />
            </Suspense>
          </section>
        ) : null}
        <QuickActions
          studioOn={studioOn}
          price={price}
          canCreate={canCreate}
          canTemplates={canTemplates}
        />
      </div>

      {/* Row 3: Signature Studio and activity */}
      <div
        className={cn(
          'grid gap-6',
          studioOn && canDocs ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : '',
        )}
      >
        {studioOn ? (
          <section className={card} aria-labelledby="studio-heading">
            <h2
              id="studio-heading"
              className="flex items-center gap-2 font-display text-2xl text-heading"
            >
              <PenTool className="size-5 text-gold" aria-hidden /> Signature Studio
            </h2>
            <p className="mt-1 text-slate-text">Create, design, and manage your signatures.</p>
            <Suspense fallback={<Skeleton className="mt-4 h-48" />}>
              <StudioPanel userId={user.id} price={price} />
            </Suspense>
          </section>
        ) : null}
        {canDocs ? (
          <section className={card} aria-labelledby="activity-heading">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2
                  id="activity-heading"
                  className="flex items-center gap-2 font-display text-2xl text-heading"
                >
                  <ChartColumn className="size-5 text-gold" aria-hidden /> Activity
                </h2>
                <p className="text-sm text-slate-text">
                  {range.label} · {fmtRange(range)}
                </p>
              </div>
            </div>
            <Suspense fallback={<Skeleton className="h-64" />}>
              <Activity {...ctx} canCreate={canCreate} />
            </Suspense>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const fmtShort = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const fmtRange = (r: DashboardRange) =>
  `${fmtShort.format(new Date(`${r.from}T00:00:00Z`))} – ${fmtShort.format(new Date(`${r.to}T00:00:00Z`))}`;

/* ------------------------------------------------------------------ range */

function RangePicker({ range }: { range: DashboardRange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Date range">
        <ul className="flex flex-wrap gap-1 rounded-xl border border-border bg-white p-1">
          {RANGE_OPTIONS.map((o) => (
            <li key={o.key}>
              <Link
                href={o.key === '30d' ? '/app' : `/app?range=${o.key}`}
                aria-current={range.key === o.key ? 'true' : undefined}
                className={cn(
                  'block rounded-lg px-3 py-1.5 text-sm font-medium',
                  range.key === o.key ? 'bg-primary text-white' : 'text-primary hover:bg-cream',
                )}
              >
                {o.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <details className="relative">
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden',
            range.key === 'custom' ? 'border-primary text-primary' : 'text-primary hover:bg-cream',
          )}
        >
          <CalendarRange className="size-4" aria-hidden /> Custom Range
        </summary>
        <form
          action="/app"
          className="absolute right-0 z-20 mt-2 flex w-64 flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-card"
        >
          <input type="hidden" name="range" value="custom" />
          <label className="flex flex-col gap-1 text-sm font-medium text-dark-text">
            From
            <input
              type="date"
              name="from"
              required
              defaultValue={range.from}
              className="h-10 rounded-lg border border-border px-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-dark-text">
            To
            <input
              type="date"
              name="to"
              required
              defaultValue={range.to}
              className="h-10 rounded-lg border border-border px-2"
            />
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary-hover"
          >
            Apply
          </button>
        </form>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ KPIs */

type Ctx = { userId: string; ws: string; tz: string; range: DashboardRange };

async function Kpis({ userId, ws, tz, range, studioOn }: Ctx & { studioOn: boolean }) {
  let a;
  try {
    a = await activityFor(userId, ws, range.from, range.to, tz);
  } catch {
    return <SectionError what="your document figures" />;
  }
  const sigs = studioOn ? await signaturesFor(userId).catch(() => null) : null;
  const purchased = sigs?.filter((s) => s.access === 'active') ?? null;
  const cards: {
    label: string;
    value: number | string;
    icon: React.ReactNode;
    href: string;
    note: React.ReactNode;
    tone?: string;
  }[] = [
    {
      label: 'Documents',
      value: a.documents.total,
      icon: <FileText />,
      href: '/app/documents',
      note: (
        <Delta
          c={compare(a.documents.created, a.documents.createdPrevious)}
          range={range}
          prefix={`${a.documents.created} new · `}
        />
      ),
    },
    {
      label: 'Sent for Signature',
      value: a.sent.current,
      icon: <Send />,
      href: '/app/documents?sort=sent',
      note: <Delta c={compare(a.sent.current, a.sent.previous)} range={range} />,
    },
    {
      label: 'Completed',
      value: a.completed.current,
      icon: <CircleCheck />,
      href: '/app/documents?tab=completed',
      tone: 'text-success bg-success-bg',
      note: <Delta c={compare(a.completed.current, a.completed.previous)} range={range} />,
    },
  ];
  if (studioOn)
    cards.push({
      label: 'My Signatures',
      value: purchased ? purchased.length : '—',
      icon: <Signature />,
      href: '/app/signature-studio/library',
      note: purchased ? 'Custom signatures & initials' : 'Could not load signatures',
    });
  return (
    <ul
      className={cn(
        'grid min-w-0 gap-4 sm:grid-cols-2',
        studioOn ? 'xl:grid-cols-4' : 'xl:grid-cols-3',
      )}
      aria-label="Summary"
    >
      {cards.map((k) => (
        <li key={k.label}>
          <Link
            href={k.href}
            className="flex h-full flex-col rounded-2xl border border-border bg-white p-5 shadow-card transition hover:border-gold/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <span className="flex items-center gap-3">
              <span
                className={cn(
                  'flex size-10 items-center justify-center rounded-full [&>svg]:size-5',
                  k.tone ?? 'bg-soft-gold/50 text-primary',
                )}
                aria-hidden
              >
                {k.icon}
              </span>
              <span className="font-display text-lg leading-tight text-heading">{k.label}</span>
            </span>
            <span className="mt-3 text-4xl font-semibold tabular-nums text-heading">{k.value}</span>
            <span className="mt-1 text-sm text-slate-text">{k.note}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Delta({
  c,
  range,
  prefix = '',
}: {
  c: ReturnType<typeof compare>;
  range: DashboardRange;
  prefix?: string;
}) {
  return (
    <>
      {prefix}
      <span
        className={cn(
          'font-semibold',
          c.tone === 'up' ? 'text-success' : c.tone === 'down' ? 'text-error' : 'text-slate-text',
        )}
      >
        {c.tone === 'up' ? '▲ ' : c.tone === 'down' ? '▼ ' : ''}
        {c.text}
      </span>{' '}
      vs {range.compareLabel}
    </>
  );
}

function KpiSkeleton() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-busy="true"
      aria-label="Loading summary"
    >
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-36" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ recent documents */

const fmtDay = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

async function Recent({
  userId,
  ws,
  selected,
  canCreate,
}: {
  userId: string;
  ws: string;
  selected: string | null;
  canCreate: boolean;
}) {
  let lib;
  try {
    lib = await searchLibrary(db(), { userId }, ws, { tab: 'all', sort: 'activity' });
  } catch {
    return <SectionError what="your recent documents" />;
  }
  const rows = lib.rows.slice(0, 6);
  if (!rows.length)
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-cream/60 px-6 py-10 text-center">
        <FileText className="size-8 text-gold" aria-hidden />
        <p className="font-display text-xl text-heading">Your documents will appear here.</p>
        {canCreate ? (
          <Link
            href="/app/documents/new"
            className={cn(
              'mt-1 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold',
              goldBtn,
            )}
          >
            <Plus className="size-4" aria-hidden /> Send Your First Document
          </Link>
        ) : null}
      </div>
    );
  return (
    <DocumentDrawerHost initialId={selected}>
      {/* Table on larger screens */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Recently updated documents, newest first</caption>
          <thead className="bg-cream/70 text-xs font-semibold text-dark-text">
            <tr>
              <th scope="col" className="rounded-l-lg px-3 py-2.5">
                Document Name
              </th>
              <th scope="col" className="px-3 py-2.5">
                Status
              </th>
              <th scope="col" className="px-3 py-2.5 text-center">
                Recipients
              </th>
              <th scope="col" className="px-3 py-2.5">
                Updated
              </th>
              <th scope="col" className="rounded-r-lg px-3 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((d) => (
              <tr key={d.id} data-doc-id={d.id} className="cursor-pointer hover:bg-cream/40">
                <td className="px-3 py-3">
                  <span className="flex items-center gap-3">
                    <FileIcon />
                    <span className="min-w-0">
                      <Link
                        href={`/app/documents/${d.id}`}
                        data-drawer-open={d.id}
                        aria-haspopup="dialog"
                        className="block truncate font-semibold text-dark-text hover:underline"
                      >
                        {d.title}
                      </Link>
                      <span className="font-mono text-xs text-slate-text">
                        {documentReference(d.id)}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge
                    status={d.status as DocumentStatus}
                    requestStatus={d.requestStatus as RequestStatus | null}
                    isTest={d.isTest}
                  />
                </td>
                <td className="px-3 py-3 text-center tabular-nums">{d.recipientCount || '—'}</td>
                <td className="whitespace-nowrap px-3 py-3">{fmtDay.format(d.lastActivity)}</td>
                <td className="px-3 py-3 text-right">
                  <RowMenu
                    doc={{
                      id: d.id,
                      title: d.title,
                      bucket: d.bucket,
                      requestId: d.requestId,
                      canDownload: d.canDownload,
                      canEdit: canCreate,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Cards on phones */}
      <ul className="flex flex-col gap-2 lg:hidden">
        {rows.map((d) => (
          <li
            key={d.id}
            data-doc-id={d.id}
            className="flex items-start gap-3 rounded-xl border border-border p-3"
          >
            <FileIcon />
            <div className="min-w-0 flex-1">
              <Link
                href={`/app/documents/${d.id}`}
                data-drawer-open={d.id}
                aria-haspopup="dialog"
                className="block truncate font-semibold text-dark-text"
              >
                {d.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-text">
                <StatusBadge
                  status={d.status as DocumentStatus}
                  requestStatus={d.requestStatus as RequestStatus | null}
                  isTest={d.isTest}
                />
                <span>
                  {d.recipientCount
                    ? `${d.recipientCount} recipient${d.recipientCount === 1 ? '' : 's'}`
                    : 'No recipients'}
                </span>
                <span>· {fmtDay.format(d.lastActivity)}</span>
              </div>
            </div>
            <RowMenu
              doc={{
                id: d.id,
                title: d.title,
                bucket: d.bucket,
                requestId: d.requestId,
                canDownload: d.canDownload,
                canEdit: canCreate,
              }}
            />
          </li>
        ))}
      </ul>
    </DocumentDrawerHost>
  );
}

function FileIcon() {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-error-bg text-[10px] font-bold text-error"
      aria-hidden
    >
      PDF
    </span>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading documents">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-11" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ quick actions */

function QuickActions({
  studioOn,
  price,
  canCreate,
  canTemplates,
}: {
  studioOn: boolean;
  price: string;
  canCreate: boolean;
  canTemplates: boolean;
}) {
  const actions = [
    studioOn && {
      href: '/app/signature-studio',
      icon: <PenTool />,
      title: 'Create Custom Signature',
      body: `Design and download for ${price}`,
    },
    canCreate && {
      href: '/app/documents/new?self=1',
      icon: <FileText />,
      title: 'Upload & Sign',
      body: 'Sign your own document, no one else needed',
    },
    canCreate && {
      href: '/app/documents/new',
      icon: <Send />,
      title: 'Send for Signature',
      body: 'Get documents signed by others',
    },
    canTemplates && {
      href: '/app/templates',
      icon: <Layers />,
      title: 'Use a Template',
      body: 'Create from a saved template',
    },
  ].filter(Boolean) as { href: string; icon: React.ReactNode; title: string; body: string }[];
  if (!actions.length) return null;
  return (
    <section className={card} aria-labelledby="qa-heading">
      <h2
        id="qa-heading"
        className="mb-4 flex items-center gap-2 font-display text-2xl text-heading"
      >
        <Zap className="size-5 text-gold" aria-hidden /> Quick Actions
      </h2>
      <ul className="flex flex-col gap-2.5">
        {actions.map((a) => (
          <li key={a.title}>
            <Link
              href={a.href}
              className="group flex items-center gap-3 rounded-xl border border-border bg-white p-3 transition hover:border-gold/60 hover:bg-cream/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-soft-gold/60 text-primary [&>svg]:size-5"
                aria-hidden
              >
                {a.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-dark-text">{a.title}</span>
                <span className="block text-sm text-slate-text">{a.body}</span>
              </span>
              <ChevronRight
                className="size-5 text-primary transition group-hover:translate-x-0.5 motion-reduce:transition-none"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ signature studio */

async function StudioPanel({ userId, price }: { userId: string; price: string }) {
  let items;
  try {
    items = await signaturesFor(userId);
  } catch {
    return (
      <div className="mt-4">
        <SectionError what="your signatures" />
      </div>
    );
  }
  const purchased = items.filter((i) => i.access === 'active');
  const preferred =
    purchased.find((i) => i.isDefault && i.kind === 'signature') ??
    purchased.find((i) => i.kind === 'signature') ??
    purchased[0];
  const draft = items.find((i) => i.status === 'draft');
  // Owners see their own design (rendered server-side for them only); everyone else a fictional sample.
  const sample = preferred
    ? null
    : await designSvg(
        {
          ...emptyDesign('signature'),
          text: { ...emptyDesign('signature').text!, value: 'Alex Morgan' },
        },
        { width: 420 },
      ).catch(() => '');
  const benefits = [
    'Create custom signatures',
    'Add initials and variations',
    'Download for use anywhere',
    'Use in your documents',
  ];

  return (
    <div className="mt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col">
          <div
            role="img"
            aria-label={
              preferred ? `Your signature: ${preferred.name}` : 'Sample signature (fictional)'
            }
            className="flex h-32 items-center justify-center rounded-xl border border-border bg-cream/50 p-3 [&>svg]:h-auto [&>svg]:max-h-28 [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: preferred ? preferred.svg : (sample ?? '') }}
          />
          <p className="mt-1.5 text-xs text-slate-text">
            {preferred
              ? `${preferred.isDefault ? 'Default · ' : ''}${preferred.name}`
              : 'Sample signature'}
          </p>
        </div>
        {purchased.length ? (
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between border-b border-border pb-2">
              <dt className="text-slate-text">Purchased designs</dt>
              <dd className="font-semibold tabular-nums text-dark-text">{purchased.length}</dd>
            </div>
            <div className="flex justify-between border-b border-border pb-2">
              <dt className="text-slate-text">Downloads</dt>
              <dd className="font-semibold text-success">Available</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-text">Default</dt>
              <dd className="font-semibold text-dark-text">
                {purchased.some((i) => i.isDefault) ? 'Set' : 'Not set'}
              </dd>
            </div>
            <p className="mt-1 text-xs text-slate-text">
              Set a default or download files in My Signatures.
            </p>
          </dl>
        ) : (
          <div>
            <p className="font-display text-lg text-heading">
              Create a Signature That&apos;s Yours.
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {benefits.map((b) => (
                <li key={b} className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-success" aria-hidden /> {b}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-text">
              Preview free. {price} per finished design.
            </p>
          </div>
        )}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Link
          href={
            draft && !purchased.length
              ? `/app/signature-studio?design=${draft.id}`
              : '/app/signature-studio'
          }
          className={cn(
            'flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold',
            goldBtn,
          )}
        >
          <PenTool className="size-4" aria-hidden />
          {draft && !purchased.length
            ? 'Continue Your Draft'
            : purchased.length
              ? 'Design a New Signature'
              : 'Design My Signature'}
        </Link>
        <Link
          href="/app/signature-studio/library"
          className="flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-primary/80 bg-white text-sm font-semibold text-primary hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          <Signature className="size-4" aria-hidden />{' '}
          {purchased.length ? 'Manage Signatures' : 'My Signatures'}
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ activity */

async function Activity({ userId, ws, tz, range, canCreate }: Ctx & { canCreate: boolean }) {
  let a;
  try {
    a = await activityFor(userId, ws, range.from, range.to, tz);
  } catch {
    return <SectionError what="your activity" />;
  }
  const any = a.daily.some((d) => d.sent || d.completed);
  if (!any)
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-cream/60 px-6 py-12 text-center">
        <ChartColumn className="size-8 text-gold" aria-hidden />
        <p className="font-display text-xl text-heading">No signing activity for this period.</p>
        <p className="text-sm text-slate-text">
          Documents you send and complete will be charted here.
        </p>
        {canCreate ? (
          <Link
            href="/app/documents/new"
            className={cn(
              'mt-1 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold',
              goldBtn,
            )}
          >
            <Send className="size-4" aria-hidden /> Send a Document
          </Link>
        ) : null}
      </div>
    );
  return <ActivityChart data={a.daily} />;
}
