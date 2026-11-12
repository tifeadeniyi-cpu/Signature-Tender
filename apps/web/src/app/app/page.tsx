import Link from 'next/link';
import {
  Send,
  CircleCheck,
  PenLine,
  CircleX,
  FileText,
  Layers,
  Files,
  UserPlus,
  ChartColumn,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  FilePlus2,
  TimerOff,
} from 'lucide-react';
import {
  getPricing,
  formatMoney,
  getProfile,
  getSendQuote,
  getWorkspaceReport,
  hasPermission,
  searchLibrary,
  DOCUMENT_TYPES,
  type DocumentStatus,
  type RequestStatus,
} from '@st/core';
import { buttonClass } from '@/components/ui/button';
import { StatusBadge } from '@/components/documents/status-badge';
import { requireWorkspace } from '@/lib/session';
import { db } from '@/lib/db';
import { StatCard, Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Badge } from '@/components/ui/feedback';

export const metadata = { title: 'Dashboard' };

function greeting(timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const QUICK_ACTIONS: { label: string; icon: typeof Send; href: string | null }[] = [
  { label: 'Send for Signature', icon: Send, href: '/app/documents/new' },
  { label: 'Use a Template', icon: Layers, href: '/app/templates' },
  { label: 'Bulk Send', icon: Files, href: null },
  { label: 'Create Template', icon: PenLine, href: '/app/templates/new' },
  { label: 'Add Contact', icon: UserPlus, href: '/app/contacts' },
  { label: 'View Reports', icon: ChartColumn, href: '/app/reports' },
];

const RECENT_TABS = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'Awaiting' },
  { key: 'completed', label: 'Completed' },
  { key: 'drafts', label: 'Drafts' },
] as const;

const fmtDay = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const typeLabel = (v: string) => DOCUMENT_TYPES.find((d) => d.value === v)?.label ?? 'Document';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ recent?: string }>;
}) {
  const { user, membership } = await requireWorkspace();
  const ws = membership.workspace.id;
  const actor = { userId: user.id };
  const recentParam = (await searchParams).recent;
  const recentTab = RECENT_TABS.find((t) => t.key === recentParam)?.key ?? 'all';
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const today = new Date().toISOString().slice(0, 10);
  const [profile, pricing, lib, recent, quote, month] = await Promise.all([
    getProfile(db(), actor),
    getPricing(db()),
    searchLibrary(db(), actor, ws, { tab: 'all' }),
    searchLibrary(db(), actor, ws, { tab: recentTab, sort: 'activity' }),
    getSendQuote(db(), actor, ws),
    getWorkspaceReport(db(), actor, ws, { from: monthStart, to: today }).catch(() => null),
  ]);
  const payg = pricing.plans.find((p) => p.code === 'payg');
  const single = pricing.prices.find((p) => p.code === 'single_request');
  const firstName = user.name.split(' ')[0] ?? user.name;
  const canCreate = hasPermission(membership.permissions, 'documents.create');
  const c = lib.counts;
  const awaiting = c.in_progress + c.pending;
  const summary =
    awaiting || c.completed
      ? `${awaiting} waiting on signers or payment, ${c.completed} completed.`
      : `Here is what is happening in ${membership.workspace.name}.`;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl">
              {greeting(profile.timezone)}, {firstName}
            </h1>
            <p className="mt-1 text-sm">{summary}</p>
          </div>
          {canCreate ? (
            <Link href="/app/documents/new" className={buttonClass('primary', 'md')}>
              <FilePlus2 className="size-4" aria-hidden /> New Document
            </Link>
          ) : null}
        </header>

        <section
          aria-label="Document summary"
          className="grid grid-cols-2 gap-3 sm:gap-4 2xl:grid-cols-5"
        >
          {[
            { label: 'Awaiting Signature', value: awaiting, icon: Send, tab: 'in_progress' },
            { label: 'Completed', value: c.completed, icon: CircleCheck, tab: 'completed' },
            { label: 'Drafts', value: c.drafts, icon: PenLine, tab: 'drafts' },
            { label: 'Declined', value: c.declined, icon: CircleX, tab: 'declined' },
            ...(c.expired
              ? [{ label: 'Expired', value: c.expired, icon: TimerOff, tab: 'expired' }]
              : []),
          ].map(({ label, value, icon: Icon, tab }) => (
            <Link key={label} href={`/app/documents?tab=${tab}`} className="rounded-2xl">
              <StatCard label={label} value={value} icon={<Icon className="size-5" />} />
            </Link>
          ))}
        </section>

        <section aria-labelledby="quick-actions">
          <h2 id="quick-actions" className="sr-only">
            Quick actions
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            {QUICK_ACTIONS.map(({ label, icon: Icon, href }) => (
              <li key={label}>
                {href ? (
                  <Link
                    href={href}
                    className="flex h-full flex-col items-center gap-2 rounded-xl border border-border bg-white p-4 text-center hover:border-primary-hover hover:bg-blush/40"
                  >
                    <Icon className="size-6 text-primary" aria-hidden />
                    <span className="text-sm font-medium text-heading">{label}</span>
                  </Link>
                ) : (
                  <div
                    className="flex h-full flex-col items-center gap-2 rounded-xl border border-border bg-white p-4 text-center opacity-60"
                    aria-disabled="true"
                  >
                    <Icon className="size-6 text-primary" aria-hidden />
                    <span className="text-sm font-medium text-heading">{label}</span>
                    <span className="text-xs">Not available yet</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <Card>
          <CardHeader
            title="Recent Documents"
            action={
              <Link
                href="/app/documents"
                className="text-sm font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            }
          />
          <nav aria-label="Recent documents filter" className="mb-3">
            <ul className="flex gap-1 border-b border-border">
              {RECENT_TABS.map((t) => (
                <li key={t.key}>
                  <Link
                    href={t.key === 'all' ? '/app' : `/app?recent=${t.key}`}
                    aria-current={recentTab === t.key ? 'page' : undefined}
                    className={`-mb-px block border-b-2 px-3 py-2 text-sm ${recentTab === t.key ? 'border-primary font-semibold text-primary-dark' : 'border-transparent text-heading'}`}
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {recent.rows.length ? (
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="Recent documents"
            >
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Document
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Recipients
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Created
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Last activity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recent.rows.slice(0, 6).map((d) => (
                    <tr key={d.id}>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/app/documents/${d.id}`}
                          className="font-semibold text-heading hover:underline"
                        >
                          {d.title}
                        </Link>
                        <p className="text-xs">{typeLabel(d.documentType)}</p>
                      </td>
                      <td className="max-w-40 truncate py-2 pr-3" title={d.signers ?? ''}>
                        {d.recipientCount ? `${d.recipientCount} · ${d.signers ?? ''}` : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge
                          status={d.status as DocumentStatus}
                          requestStatus={d.requestStatus as RequestStatus | null}
                          isTest={d.isTest}
                        />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {fmtDay.format(d.sentAt ?? d.lastActivity)}
                      </td>
                      <td className="whitespace-nowrap py-2">{fmtDay.format(d.lastActivity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<FileText className="size-5" />}
              title={recentTab === 'all' ? 'No documents yet' : 'Nothing here yet'}
            >
              Documents you send for signature will appear here with their status and last activity.
            </EmptyState>
          )}
        </Card>
      </div>

      <aside className="flex flex-col gap-6" aria-label="Account overview">
        <Card>
          <h2 className="font-display text-lg">Your Plan</h2>
          <p className="mt-1 text-sm font-semibold text-heading">{payg?.name ?? 'Pay As You Go'}</p>
          {single ? (
            <p className="mt-3 text-sm">
              {formatMoney(single.amountCents)} per signing request. No subscription required.
            </p>
          ) : null}
          {quote ? (
            <dl className="mt-4 flex flex-col gap-1 rounded-lg bg-blush px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <dt>Available credits</dt>
                <dd className="font-semibold text-heading">{quote.balances.available}</dd>
              </div>
              {month ? (
                <div className="flex items-center justify-between">
                  <dt>Sent this month</dt>
                  <dd className="font-semibold text-heading">{month.totals.sent}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/app/billing" className={buttonClass('secondary', 'sm')}>
              Buy Credits
            </Link>
            <Link href="/app/billing" className={buttonClass('ghost', 'sm')}>
              Manage Plan
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className="font-display text-lg">Quick Links</h2>
          <ul className="mt-3 flex flex-col">
            {[
              { href: '/app/settings', label: 'Workspace settings' },
              { href: '/app/templates', label: 'Templates' },
              { href: '/app/contacts', label: 'Contacts' },
              { href: '/app/team?tab=roles', label: 'Team permissions' },
              { href: '/app/integrations', label: 'Integrations' },
              { href: '/developers', label: 'Help and API docs' },
            ].map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-heading hover:bg-blush"
                >
                  {l.label}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="bg-gradient-to-br from-white to-blush">
          {profile.twoFactorEnabled ? (
            <ShieldCheck className="size-7 text-success" aria-hidden />
          ) : (
            <ShieldAlert className="size-7 text-warning" aria-hidden />
          )}
          <h2 className="mt-2 font-display text-lg">Every signature, on the record</h2>
          <p className="mt-1 text-sm">
            Each completed document includes a timestamped, tamper-evident audit trail and a
            completion certificate.
          </p>
          <div className="mt-3">
            {profile.twoFactorEnabled ? (
              <Badge tone="success">Two-step verification on</Badge>
            ) : (
              <Link
                href="/app/settings/security"
                className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
              >
                Turn on two-step verification
              </Link>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
