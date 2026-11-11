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
} from 'lucide-react';
import { getPricing, formatMoney, getProfile } from '@st/core';
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

const QUICK_ACTIONS = [
  { label: 'Send for Signature', icon: Send },
  { label: 'Use a Template', icon: Layers },
  { label: 'Bulk Send', icon: Files },
  { label: 'Create Template', icon: PenLine },
  { label: 'Add Contact', icon: UserPlus },
  { label: 'View Reports', icon: ChartColumn },
];

export default async function DashboardPage() {
  const { user, membership } = await requireWorkspace();
  const [profile, pricing] = await Promise.all([
    getProfile(db(), { userId: user.id }),
    getPricing(db()),
  ]);
  const payg = pricing.plans.find((p) => p.code === 'payg');
  const single = pricing.prices.find((p) => p.code === 'single_request');
  const firstName = user.name.split(' ')[0] ?? user.name;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl">
              {greeting(profile.timezone)}, {firstName}
            </h1>
            <p className="mt-1 text-sm">
              Here is what is happening in {membership.workspace.name}.
            </p>
          </div>
          <span
            className="inline-flex items-center gap-2 rounded-lg bg-primary/60 px-4 py-2.5 text-sm font-semibold text-white"
            aria-disabled="true"
            title="Document creation arrives in the next phase"
          >
            <FilePlus2 className="size-4" aria-hidden /> New Document{' '}
            <span className="text-xs font-normal">(coming soon)</span>
          </span>
        </header>

        <section
          aria-label="Document summary"
          className="grid grid-cols-2 gap-3 sm:gap-4 2xl:grid-cols-4"
        >
          <StatCard label="Awaiting Signature" value={0} icon={<Send className="size-5" />} />
          <StatCard label="Completed" value={0} icon={<CircleCheck className="size-5" />} />
          <StatCard label="Drafts" value={0} icon={<PenLine className="size-5" />} />
          <StatCard label="Declined" value={0} icon={<CircleX className="size-5" />} />
        </section>

        <section aria-labelledby="quick-actions">
          <h2 id="quick-actions" className="sr-only">
            Quick actions
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            {QUICK_ACTIONS.map(({ label, icon: Icon }) => (
              <li key={label}>
                <div
                  className="flex h-full flex-col items-center gap-2 rounded-xl border border-border bg-white p-4 text-center opacity-60"
                  aria-disabled="true"
                >
                  <Icon className="size-6 text-primary" aria-hidden />
                  <span className="text-sm font-medium text-heading">{label}</span>
                  <span className="text-xs">Coming soon</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <Card>
          <CardHeader title="Recent Documents" />
          <EmptyState icon={<FileText className="size-5" />} title="No documents yet">
            Documents you send for signature will appear here with their status and last activity.
          </EmptyState>
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
          <dl className="mt-4 flex items-center justify-between rounded-lg bg-blush px-3 py-2 text-sm">
            <dt>Signing credits</dt>
            <dd className="font-semibold text-heading">0</dd>
          </dl>
          <p className="mt-2 text-xs">Credit purchases open with Billing & Credits.</p>
        </Card>

        <Card>
          <h2 className="font-display text-lg">Quick Links</h2>
          <ul className="mt-3 flex flex-col">
            {[
              { href: '/app/settings', label: 'Workspace settings' },
              { href: '/app/settings/profile', label: 'Your profile' },
              { href: '/app/settings/security', label: 'Sign-in and security' },
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
            Each completed document will include a timestamped audit trail and a completion
            certificate.
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
