import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Clock, Coins, Gift, Trophy, Wallet } from 'lucide-react';
import {
  AppError,
  ensureReferralLink,
  getReferralCenter,
  type ReferralActivityRow,
  type ReferralHistoryRow,
} from '@st/core';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { ReferralShareTools } from '@/components/referrals/share-tools';
import { cn } from '@/lib/cn';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { referralUrl } from '@/lib/referrals';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Refer & Earn | Signature Tender' };

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const fmt = (d: Date | null) => (d ? dateFmt.format(d) : '—');

const STATUS: Record<ReferralHistoryRow['status'], { label: string; cls: string }> = {
  pending_verification: { label: 'Pending Verification', cls: 'bg-slate-100 text-slate-700' },
  awaiting_purchase: { label: 'Awaiting First Purchase', cls: 'bg-[#F3DEB4]/60 text-[#5B4318]' },
  under_review: { label: 'Under Review', cls: 'bg-warning-bg text-warning' },
  rewarded: { label: 'Rewarded', cls: 'bg-success-bg text-success' },
  ineligible: { label: 'Ineligible', cls: 'bg-slate-100 text-slate-700' },
  reversed: { label: 'Reversed', cls: 'bg-error-bg text-error' },
};

const ACTIVITY: Record<ReferralActivityRow['type'], string> = {
  welcome: 'Welcome credit',
  reward: 'Referral reward',
  reversal: 'Reward reversed',
  adjustment: 'Adjustment',
  used: 'Used for a document',
  returned: 'Returned (send cancelled)',
};
const ACTIVITY_FILTERS = {
  all: null,
  earned: ['welcome', 'reward'],
  redeemed: ['used', 'returned'],
  reversed: ['reversal', 'adjustment'],
} as const;

const STEPS = [
  'Friend Registers',
  'Friend Verifies Email',
  'Friend Makes First Qualifying Purchase',
  'You Receive Your Credits',
];

function Progress({ step, status }: { step: number; status: ReferralHistoryRow['status'] }) {
  const stopped = status === 'ineligible' || status === 'reversed';
  return (
    <ol
      className="flex items-center gap-1"
      aria-label={`Progress: step ${step} of 4${stopped ? ', stopped' : ''}`}
    >
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n <= step && !(stopped && n === 4);
        const current = n === step + 1 && !stopped;
        return (
          <li key={label} className="flex items-center gap-1">
            <span
              title={label}
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold',
                done && 'border-success bg-success text-white',
                current && 'border-[#D8AF68] bg-[#F3DEB4] text-[#0D1B33]',
                !done && !current && 'border-border bg-white text-slate-text',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : n}
              <span className="sr-only">
                {label}: {done ? 'done' : current ? 'current step' : 'not yet'}
              </span>
            </span>
            {n < 4 ? (
              <span className={cn('h-0.5 w-3', done ? 'bg-success' : 'bg-border')} aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; activity?: string }>;
}) {
  const sp = await searchParams;
  const { user, membership } = await requireWorkspace();
  const actor = { userId: user.id };
  const ws = membership.workspace.id;
  let linkError: string | null = null;
  const before = await getReferralCenter(db(), actor, ws);
  if (before.program.live && !before.link) {
    try {
      await ensureReferralLink(db(), actor, ws);
    } catch (err) {
      if (err instanceof AppError) linkError = err.message;
      else throw err;
    }
  }
  const c =
    before.link || linkError || !before.program.live
      ? before
      : await getReferralCenter(db(), actor, ws);
  const p = c.program;
  const filter = sp.filter === 'rewarded' || sp.filter === 'pending' ? sp.filter : 'all';
  const history = c.history.filter((h) =>
    filter === 'all'
      ? true
      : filter === 'rewarded'
        ? h.status === 'rewarded'
        : ['pending_verification', 'awaiting_purchase', 'under_review'].includes(h.status),
  );
  const activityKey = (
    sp.activity && sp.activity in ACTIVITY_FILTERS ? sp.activity : 'all'
  ) as keyof typeof ACTIVITY_FILTERS;
  const allowed = ACTIVITY_FILTERS[activityKey] as readonly string[] | null;
  const activity = allowed ? c.activity.filter((a) => allowed.includes(a.type)) : c.activity;
  const pendingCredits =
    c.history.filter((h) => h.status === 'awaiting_purchase' || h.status === 'under_review')
      .length * p.referrerCredits;

  const cards = [
    {
      label: 'Successful Referrals',
      value: c.summary.successful,
      icon: Trophy,
      href: '?filter=rewarded#history',
    },
    {
      label: 'Pending Referrals',
      value: c.summary.pending,
      icon: Clock,
      href: '?filter=pending#history',
    },
    {
      label: 'Credits Earned',
      value: c.summary.earned,
      icon: Coins,
      href: '?activity=earned#activity',
    },
    {
      label: 'Available Referral Credits',
      value: c.canSeeBalance ? c.summary.available : '—',
      icon: Wallet,
      href: c.canSeeBalance ? '/app/billing' : '#activity',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Refer & Earn"
        description="Invite friends, share the rewards, and earn free document-signing credits."
      />

      <section
        aria-labelledby="refer-hero"
        className="overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#0D1B33_0%,#172D4D_60%,#0A1629_100%)] p-6 text-white shadow-card sm:p-10"
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#D8AF68]/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#F3DEB4]">
              <Gift className="size-3.5" aria-hidden /> {p.name}
            </p>
            <h2 id="refer-hero" className="mt-4 font-display text-4xl leading-tight sm:text-5xl">
              Give {p.referredCredits}. Get {p.referrerCredits}.
            </h2>
            <p className="mt-3 max-w-2xl text-[#CBD5E1]">
              Your friends get {p.referredCredits} free signing credit
              {p.referredCredits === 1 ? '' : 's'} when they join. You get {p.referrerCredits} when
              they make their first qualifying purchase.
            </p>
            <div className="mt-6">
              {!p.live ? (
                <p
                  role="status"
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-[#F3DEB4]"
                >
                  The referral program is paused right now. Rewards you have already earned stay in
                  your workspace.
                </p>
              ) : linkError ? (
                <p
                  role="status"
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-[#F3DEB4]"
                >
                  {linkError}
                </p>
              ) : c.link?.status === 'revoked' ? (
                <p
                  role="status"
                  className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-[#F3DEB4]"
                >
                  Your referral link has been turned off. Contact support if you think this is a
                  mistake.
                </p>
              ) : c.link ? (
                <ReferralShareTools
                  url={referralUrl(c.link.code)}
                  code={c.link.code}
                  message={p.settings.shareMessage}
                  referredCredits={p.referredCredits}
                  referrerCredits={p.referrerCredits}
                />
              ) : null}
            </div>
          </div>
          <div
            className="hidden shrink-0 grid-cols-2 gap-3 text-center sm:grid lg:w-64 lg:grid-cols-1"
            aria-hidden
          >
            <div className="rounded-2xl border border-[#D8AF68]/40 bg-white/[0.04] p-4">
              <p className="font-display text-5xl text-[#D8AF68]">{p.referrerCredits}</p>
              <p className="mt-1 text-sm text-[#CBD5E1]">Free credits for you</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-4">
              <p className="font-display text-5xl text-[#F3DEB4]">{p.referredCredits}</p>
              <p className="mt-1 text-sm text-[#CBD5E1]">Free credit for your friend</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className="flex items-center gap-4 rounded-2xl border border-border bg-white p-4 shadow-card hover:border-[#D8AF68] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D1B33] sm:p-5"
          >
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#F3DEB4]/50 text-[#0D1B33]"
              aria-hidden
            >
              <k.icon className="size-5" />
            </span>
            <span>
              <span className="block text-2xl font-semibold text-heading">{k.value}</span>
              <span className="block text-sm">{k.label}</span>
            </span>
          </Link>
        ))}
      </div>
      {pendingCredits > 0 ? (
        <p className="mt-2 text-sm">
          {pendingCredits} credits pending: added once your friends make their first qualifying
          purchase.
        </p>
      ) : null}

      <Card className="mt-6">
        <CardHeader title="How it works" />
        <ol className="grid gap-4 sm:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0D1B33] text-sm font-semibold text-[#F3DEB4]">
                {i + 1}
              </span>
              <span className="text-sm text-heading">
                {i === 3 ? `You Receive ${p.referrerCredits} Credits` : s}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-6">
        <div id="history" className="scroll-mt-24" />
        <CardHeader
          title="Your Referrals"
          action={
            <nav
              aria-label="Filter referrals"
              className="flex gap-1 rounded-xl bg-blush p-1 text-sm"
            >
              {(['all', 'pending', 'rewarded'] as const).map((f) => (
                <Link
                  key={f}
                  href={f === 'all' ? '/app/referrals#history' : `?filter=${f}#history`}
                  aria-current={filter === f ? 'page' : undefined}
                  className={cn(
                    'rounded-lg px-3 py-1.5 font-semibold',
                    filter === f ? 'bg-[#0D1B33] text-white' : 'text-heading hover:bg-white',
                  )}
                >
                  {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Rewarded'}
                </Link>
              ))}
            </nav>
          }
        />
        {history.length === 0 ? (
          <EmptyState
            icon={<Gift className="size-5" />}
            title={c.history.length ? 'No referrals match this filter' : 'No referrals yet'}
          >
            Share your link. Friends who join appear here once they create an account.
          </EmptyState>
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Your referrals</caption>
              <thead className="text-xs uppercase tracking-wide text-slate-text">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    Referred Customer
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Date Joined
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Referral Status
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Progress
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Reward
                  </th>
                  <th scope="col" className="py-2">
                    Reward Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-3 pr-4 font-medium text-heading">{h.displayName}</td>
                    <td className="py-3 pr-4">{fmt(h.joinedAt)}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                          STATUS[h.status].cls,
                        )}
                      >
                        {STATUS[h.status].label}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <Progress step={h.step} status={h.status} />
                    </td>
                    <td className="py-3 pr-4 font-semibold">
                      {h.rewardCredits > 0 ? (
                        <span className="text-success">+{h.rewardCredits} Credits</span>
                      ) : h.status === 'awaiting_purchase' ||
                        h.status === 'under_review' ||
                        h.status === 'pending_verification' ? (
                        <span className="text-slate-text">{p.referrerCredits} Credits Pending</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3">{fmt(h.rewardedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <div id="activity" className="scroll-mt-24" />
        <CardHeader
          title="Reward Activity"
          description="Every referral credit added to or used from this workspace."
          action={
            c.canSeeBalance ? (
              <nav
                aria-label="Filter reward activity"
                className="flex flex-wrap gap-1 rounded-xl bg-blush p-1 text-sm"
              >
                {(Object.keys(ACTIVITY_FILTERS) as (keyof typeof ACTIVITY_FILTERS)[]).map((f) => (
                  <Link
                    key={f}
                    href={f === 'all' ? '/app/referrals#activity' : `?activity=${f}#activity`}
                    aria-current={activityKey === f ? 'page' : undefined}
                    className={cn(
                      'rounded-lg px-3 py-1.5 font-semibold',
                      activityKey === f ? 'bg-[#0D1B33] text-white' : 'text-heading hover:bg-white',
                    )}
                  >
                    {f === 'all' ? 'All Activity' : f[0]!.toUpperCase() + f.slice(1)}
                  </Link>
                ))}
              </nav>
            ) : null
          }
        />
        {!c.canSeeBalance ? (
          <Alert tone="info">
            Your role cannot see this workspace&rsquo;s credit balance. Ask an owner or admin.
          </Alert>
        ) : activity.length === 0 ? (
          <EmptyState icon={<Coins className="size-5" />} title="No referral credit activity yet">
            Rewards and their use will appear here.
          </EmptyState>
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[600px] text-left text-sm">
              <caption className="sr-only">Referral credit activity</caption>
              <thead className="text-xs uppercase tracking-wide text-slate-text">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    Date
                  </th>
                  <th scope="col" className="py-2 pr-4">
                    Type
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    Earned
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    Used
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Remaining
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 pr-4">{fmt(a.at)}</td>
                    <td className="py-3 pr-4 text-heading">{ACTIVITY[a.type]}</td>
                    <td className="py-3 pr-4 text-right text-success">
                      {a.delta > 0 ? `+${a.delta}` : ''}
                    </td>
                    <td className="py-3 pr-4 text-right">{a.delta < 0 ? a.delta : ''}</td>
                    <td className="py-3 text-right font-semibold">{a.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-6 text-sm">
        Referral credits pay for standard documents sent from the website. They have no cash value,
        cannot be transferred and cannot be used for Signature Studio designs or API sends.{' '}
        <Link
          href={p.settings.termsUrl}
          className="font-semibold text-primary underline underline-offset-2"
        >
          Program terms
        </Link>
      </p>
    </div>
  );
}
