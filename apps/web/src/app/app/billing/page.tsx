import Link from 'next/link';
import { CreditCard, ExternalLink } from 'lucide-react';
import {
  AppError,
  bundleSavingsPercent,
  formatMoney,
  getBillingOverview,
  getConfigValue,
  reconcileCredits,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { paymentsAvailable } from '@/lib/billing';
import { stripeLiveMode } from '@/lib/stripe';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { ActionButton } from './billing-buttons';
import { buyCreditsAction, changePlanAction, openPortalAction, subscribeAction } from './actions';

export const metadata = { title: 'Billing & Credits' };

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'plans', label: 'Plans & Pricing' },
  { id: 'credits', label: 'Credits' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'payments', label: 'Payment History' },
  { id: 'usage', label: 'Usage' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const fmtDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const day = (d: Date | null | undefined) => (d ? fmtDate.format(d) : '—');

const PAYMENT_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'error' }
> = {
  pending: { label: 'Not completed', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  expired: { label: 'Abandoned', tone: 'neutral' },
  refunded: { label: 'Refunded', tone: 'warning' },
  partially_refunded: { label: 'Partly refunded', tone: 'warning' },
  disputed: { label: 'Disputed', tone: 'error' },
};
const PAYMENT_KIND: Record<string, string> = {
  credits: 'Credit purchase',
  request: 'Single request',
  subscription: 'Subscription',
};
const LEDGER_LABEL: Record<string, string> = {
  purchase: 'Credits purchased',
  subscription_allowance: 'Monthly allowance',
  promotional: 'Promotional credits',
  admin_adjustment: 'Adjustment',
  reserve: 'Used for a request',
  restore: 'Credit restored',
  expire: 'Allowance expired',
  reversal: 'Reversed (refund or dispute)',
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = (TABS.find((t) => t.id === sp.tab)?.id ?? 'overview') as Tab;
  const { user, membership } = await requireWorkspace();
  const actor = { userId: user.id };
  const workspaceId = membership.workspace.id;

  let o: Awaited<ReturnType<typeof getBillingOverview>>;
  try {
    o = await getBillingOverview(db(), actor, workspaceId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'forbidden') {
      return (
        <div className="mx-auto max-w-3xl">
          <PageHeader title="Billing & Credits" icon={<CreditCard className="size-8" />} />
          <Alert tone="info">
            Your role does not include billing. Ask a workspace owner or admin about credits and
            plans.
          </Alert>
        </div>
      );
    }
    throw err;
  }
  const paymentsOn = await paymentsAvailable();
  const supportEmail = await getConfigValue(db(), 'support.email', 'support@signaturetender.com');
  const canBuy = o.canManage && paymentsOn;
  const notice = !paymentsOn
    ? 'Online payments are not switched on yet. These are the launch prices; no charge can be made.'
    : !o.canManage
      ? 'Only workspace owners and admins can buy credits or change plans.'
      : null;
  const single = o.prices.find((p) => p.code === 'single_request');

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Billing & Credits"
        description="Manage credits, plans, payments and invoices."
        icon={<CreditCard className="size-8" />}
        actions={
          o.canManage && o.account?.hasCustomer && paymentsOn ? (
            <ActionButton action={openPortalAction} label="Manage billing" variant="secondary" />
          ) : null
        }
      />
      {notice ? (
        <Alert tone="info" className="mb-4">
          {notice}
        </Alert>
      ) : null}
      {paymentsOn && !stripeLiveMode() ? (
        <Alert tone="warning" className="mb-4">
          Stripe test mode. No real money moves. Use test card 4242 4242 4242 4242 with any future
          date and any CVC.
        </Alert>
      ) : null}

      <nav aria-label="Billing sections" className="mb-6 overflow-x-auto">
        <ul className="flex min-w-max gap-1 rounded-xl bg-white p-1 shadow-card">
          {TABS.map((t) => (
            <li key={t.id}>
              <Link
                href={`/app/billing?tab=${t.id}`}
                aria-current={tab === t.id ? 'page' : undefined}
                className={cn(
                  'block rounded-lg px-4 py-2 text-sm font-semibold',
                  tab === t.id ? 'bg-primary text-white' : 'text-slate-text hover:bg-blush',
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'overview' ? (
        <div className="flex flex-col gap-6">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-text">
              Current billing model
            </p>
            {o.isSubscribed && o.plan ? (
              <>
                <p className="mt-1 font-display text-3xl">{o.plan.name} plan</p>
                <p className="mt-1 text-sm">
                  {formatMoney(o.plan.monthlyPriceCents ?? 0, o.plan.currency)} a month,{' '}
                  {o.plan.includedRequests} requests included, then{' '}
                  {formatMoney(o.plan.overagePriceCents ?? 0, o.plan.currency)} per additional
                  request.
                </p>
                {o.account?.subscriptionStatus === 'past_due' ? (
                  <Alert tone="error" className="mt-3">
                    Your last payment failed. Update your payment method in Manage billing to keep
                    your plan.
                  </Alert>
                ) : null}
              </>
            ) : (
              <>
                <p className="mt-1 font-display text-3xl">Pay As You Go — No Subscription</p>
                <p className="mt-1 text-sm">
                  You pay only when you send:{' '}
                  {formatMoney(o.requestPrice.amountCents, o.requestPrice.currency)} per request, or
                  less with a credit pack. No recurring charges.
                </p>
              </>
            )}
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Available credits" value={String(o.balances.available)}>
              {o.balances.allowance > 0
                ? `${o.balances.allowance} from this month's allowance, ${o.balances.purchased} purchased`
                : `${o.balances.purchased} purchased`}
            </Stat>
            <Stat label="Requests sent this month" value={String(o.usage.sentThisMonth)}>
              Test requests are not counted.
            </Stat>
            {o.canManage ? (
              <Stat label="Total spending" value={formatMoney(o.spend.total)}>
                {formatMoney(o.spend.month)} this month, after refunds
              </Stat>
            ) : null}
            {o.isSubscribed ? (
              <Stat
                label={o.account?.cancelAtPeriodEnd ? 'Plan ends' : 'Next billing date'}
                value={day(o.account?.currentPeriodEnd)}
              >
                {o.account?.cancelAtPeriodEnd
                  ? 'Renewal is cancelled. You can reactivate in Manage billing.'
                  : 'Unused monthly requests do not roll over.'}
              </Stat>
            ) : null}
          </div>
          {o.usage.awaitingPayment > 0 ? (
            <Alert tone="warning">
              {o.usage.awaitingPayment}{' '}
              {o.usage.awaitingPayment === 1 ? 'request is' : 'requests are'} prepared but waiting
              for payment. Open them from{' '}
              <Link href="/app/documents" className="underline">
                Documents
              </Link>
              .
            </Alert>
          ) : null}
          {o.canManage ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <Card>
                <CardHeader title="Recent transactions" />
                <PaymentsTable payments={o.payments.slice(0, 5)} invoices={o.invoices} compact />
              </Card>
              <Card>
                <CardHeader title="Payment method" />
                <p className="text-sm">
                  Cards are stored and charged by Stripe. Signature Tender never sees or stores your
                  card number or security code.
                </p>
                {o.account?.hasCustomer && paymentsOn ? (
                  <ActionButton
                    action={openPortalAction}
                    label="Change payment method"
                    variant="secondary"
                    className="mt-4"
                  />
                ) : (
                  <p className="mt-3 text-sm">
                    No payment method yet. One is added at your first checkout.
                  </p>
                )}
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'plans' ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {o.plans.map((p) => {
              const current = (o.isSubscribed ? o.plan?.code : 'payg') === p.code;
              const descId = `plan-${p.code}-note`;
              return (
                <Card
                  key={p.code}
                  as="article"
                  className={cn('flex flex-col p-5', current && 'border-2 border-primary')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-xl">{p.name}</h2>
                    {current ? <Badge tone="success">Current</Badge> : null}
                  </div>
                  <p className="mt-2 font-display text-3xl">
                    {p.isCustom ? 'Custom' : formatMoney(p.monthlyPriceCents ?? 0, p.currency)}
                    {!p.isCustom ? <span className="text-sm font-normal"> /month</span> : null}
                  </p>
                  <ul className="mt-3 flex flex-1 flex-col gap-1 text-sm">
                    <li>
                      {p.isCustom
                        ? 'Volume set for your organization'
                        : p.includedRequests
                          ? `${p.includedRequests} requests a month`
                          : 'No monthly fee or commitment'}
                    </li>
                    <li>
                      {p.isCustom
                        ? 'Negotiated per-request price'
                        : `${formatMoney(p.overagePriceCents ?? 0, p.currency)} per ${p.includedRequests ? 'additional ' : ''}request`}
                    </li>
                    <li>Up to five signers per request</li>
                  </ul>
                  <div className="mt-4">
                    {current ? null : p.isCustom ? (
                      <a
                        href={`mailto:${supportEmail}?subject=Enterprise%20plan`}
                        className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-border bg-white text-sm font-semibold text-heading hover:bg-blush"
                      >
                        Contact us
                      </a>
                    ) : p.code === 'payg' ? (
                      <p id={descId} className="text-xs">
                        To return to Pay As You Go, cancel renewal in Manage billing. Your plan
                        stays active until the end of the period.
                      </p>
                    ) : o.isSubscribed ? (
                      <ActionButton
                        action={changePlanAction.bind(null, p.code)}
                        label={`Switch to ${p.name}`}
                        variant="secondary"
                        disabled={!canBuy}
                      />
                    ) : (
                      <ActionButton
                        action={subscribeAction.bind(null, p.code)}
                        label={`Choose ${p.name}`}
                        disabled={!canBuy}
                      />
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          <Card>
            <h2 className="font-display text-xl">How plan changes work</h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
              <li>
                Upgrades take effect immediately. Stripe charges the prorated difference for the
                rest of the month, and the extra requests are added as soon as that payment
                succeeds.
              </li>
              <li>
                Downgrades apply from your next billing date. There is no refund for the current
                month.
              </li>
              <li>Monthly requests reset each billing period and unused ones do not roll over.</li>
              <li>Purchased credits never expire and are used after your monthly requests.</li>
              <li>
                Cancel renewal at any time in Manage billing. Pay As You Go has no recurring
                charges.
              </li>
            </ul>
            <p className="mt-3 text-xs">
              These are launch prices and may change. Any change is shown here before you buy.
            </p>
          </Card>
        </div>
      ) : null}

      {tab === 'credits' ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Available balance" value={String(o.balances.available)}>
              Ready to use for sending.
            </Stat>
            <Stat label="Monthly allowance left" value={String(o.balances.allowance)}>
              {o.isSubscribed
                ? `Resets ${day(o.account?.currentPeriodEnd)}`
                : 'Subscribe to a plan to get a monthly allowance.'}
            </Stat>
            <Stat label="Purchased credits" value={String(o.balances.purchased)}>
              Purchased credits never expire.
            </Stat>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {o.prices.map((p) => {
              const savings =
                single && p.code !== single.code ? bundleSavingsPercent(single, p) : 0;
              return (
                <Card key={p.code} as="article" className="flex flex-col p-5">
                  <h2 className="font-display text-lg">
                    {p.credits === 1 ? 'Single request' : `${p.credits} credits`}
                  </h2>
                  <p className="mt-2 font-display text-3xl">
                    {formatMoney(p.amountCents, p.currency)}
                  </p>
                  <p className="mt-1 flex-1 text-sm">
                    {formatMoney(Math.round(p.amountCents / p.credits), p.currency)} per request
                    {savings > 0 ? (
                      <span className="ml-2 inline-block">
                        <Badge tone="success">Save {savings}%</Badge>
                      </span>
                    ) : null}
                  </p>
                  <ActionButton
                    action={buyCreditsAction.bind(null, p.code)}
                    label={p.credits === 1 ? 'Buy 1 credit' : `Buy ${p.credits} credits`}
                    disabled={!canBuy}
                    className="mt-4"
                  />
                </Card>
              );
            })}
          </div>
          <p className="text-sm">
            Prices are in US dollars. One credit sends one signing request with up to five signers.
            You will see the final total on Stripe&rsquo;s secure checkout page before you pay;
            there are no extra fees. Credits are added once Stripe confirms the payment.
          </p>
        </div>
      ) : null}

      {tab === 'invoices' ? (
        o.canManage ? (
          <InvoicesTab
            invoices={o.invoices}
            q={sp.q}
            status={sp.status}
            from={sp.from}
            to={sp.to}
          />
        ) : (
          <Alert tone="info">Only workspace owners and admins can see invoices.</Alert>
        )
      ) : null}

      {tab === 'payments' ? (
        o.canManage ? (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader title="Transactions" />
              <PaymentsTable payments={o.payments} invoices={o.invoices} />
            </Card>
            <Card>
              <CardHeader
                title="Credit activity"
                description="Every credit added, used, restored or expired."
              />
              <LedgerTable ledger={o.ledger} />
            </Card>
            <Reconciliation workspaceId={workspaceId} userId={user.id} />
          </div>
        ) : (
          <Alert tone="info">Only workspace owners and admins can see payment history.</Alert>
        )
      ) : null}

      {tab === 'usage' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Credits purchased" value={String(o.usage.creditsPurchased)}>
            All time
          </Stat>
          <Stat label="Credits used" value={String(o.usage.creditsConsumed)}>
            All time, after restored credits
          </Stat>
          <Stat label="Requests completed" value={String(o.usage.completed)}>
            Real requests, all time
          </Stat>
          <Stat label="Requests cancelled" value={String(o.usage.cancelled)}>
            Real requests, all time
          </Stat>
          <Stat label="Monthly allowance used" value={String(o.usage.allowanceUsed)}>
            {o.isSubscribed && o.plan
              ? `of ${o.plan.includedRequests} this billing period`
              : 'No subscription'}
          </Stat>
          <Stat label="API requests" value="0">
            API access is not available yet.
          </Stat>
          {o.canManage ? (
            <Stat label="Spent this month" value={formatMoney(o.spend.month)}>
              After refunds
            </Stat>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-text">{label}</p>
      <p className="mt-1 font-display text-3xl text-heading">{value}</p>
      {children ? <p className="mt-1 text-xs">{children}</p> : null}
    </Card>
  );
}

type Overview = Awaited<ReturnType<typeof getBillingOverview>>;

function PaymentsTable({
  payments,
  invoices,
  compact,
}: {
  payments: Overview['payments'];
  invoices: Overview['invoices'];
  compact?: boolean;
}) {
  if (!payments.length) return <p className="text-sm">No transactions yet.</p>;
  const byInvoice = new Map(invoices.map((i) => [i.stripeInvoiceId, i]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase text-slate-text">
          <tr>
            {!compact ? <th className="py-2 pr-3 font-semibold">Transaction</th> : null}
            <th className="py-2 pr-3 font-semibold">Date</th>
            <th className="py-2 pr-3 font-semibold">Type</th>
            <th className="py-2 pr-3 font-semibold">Credits</th>
            <th className="py-2 pr-3 font-semibold">Amount</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 font-semibold">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const inv = p.stripeInvoiceId ? byInvoice.get(p.stripeInvoiceId) : undefined;
            const st = PAYMENT_STATUS[p.status] ?? { label: p.status, tone: 'neutral' as const };
            return (
              <tr key={p.id} className="border-t border-border">
                {!compact ? (
                  <td className="py-2 pr-3 font-mono text-xs" title={p.id}>
                    {p.id.slice(0, 8).toUpperCase()}
                  </td>
                ) : null}
                <td className="py-2 pr-3">{day(p.paidAt ?? p.createdAt)}</td>
                <td className="py-2 pr-3">
                  <span className="block text-heading">{PAYMENT_KIND[p.kind]}</span>
                  <span className="text-xs">{p.description}</span>
                </td>
                <td className="py-2 pr-3">{p.credits || '—'}</td>
                <td className="py-2 pr-3">
                  {formatMoney(p.amountCents, p.currency)}
                  {p.amountRefundedCents ? (
                    <span className="block text-xs">
                      {formatMoney(p.amountRefundedCents, p.currency)} refunded
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <Badge tone={st.tone}>{st.label}</Badge>
                </td>
                <td className="py-2">
                  {inv?.hostedUrl ? (
                    <a
                      href={inv.hostedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline"
                    >
                      View <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only">(opens Stripe)</span>
                    </a>
                  ) : (
                    <span className="text-xs">{p.status === 'paid' ? 'Being prepared' : '—'}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LedgerTable({ ledger }: { ledger: Overview['ledger'] }) {
  if (!ledger.length) return <p className="text-sm">No credit activity yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="text-xs uppercase text-slate-text">
          <tr>
            <th className="py-2 pr-3 font-semibold">Date</th>
            <th className="py-2 pr-3 font-semibold">Activity</th>
            <th className="py-2 pr-3 font-semibold">Type</th>
            <th className="py-2 font-semibold">Credits</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((l) => (
            <tr key={l.id} className="border-t border-border">
              <td className="py-2 pr-3">{day(l.createdAt)}</td>
              <td className="py-2 pr-3">
                <span className="block text-heading">{LEDGER_LABEL[l.entryType]}</span>
                {l.note ? <span className="text-xs">{l.note}</span> : null}
              </td>
              <td className="py-2 pr-3 text-xs">
                {l.bucket === 'allowance' ? 'Monthly allowance' : 'Purchased'}
              </td>
              <td
                className={cn('py-2 font-semibold', l.delta > 0 ? 'text-success' : 'text-heading')}
              >
                {l.delta > 0 ? `+${l.delta}` : l.delta}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTab({
  invoices,
  q,
  status,
  from,
  to,
}: {
  invoices: Overview['invoices'];
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}) {
  const query = (q ?? '').trim().toLowerCase();
  const fromD = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00Z`) : null;
  const toD = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59Z`) : null;
  const rows = invoices.filter(
    (i) =>
      (!query ||
        (i.number ?? '').toLowerCase().includes(query) ||
        (i.description ?? '').toLowerCase().includes(query)) &&
      (!status || status === 'all' || i.status === status) &&
      (!fromD || i.issuedAt >= fromD) &&
      (!toD || i.issuedAt <= toD),
  );
  const field = 'h-10 rounded-lg border border-border bg-white px-3 text-sm';
  return (
    <Card>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Filter invoices"
      >
        <input type="hidden" name="tab" value="invoices" />
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          Search
          <input name="q" defaultValue={q} placeholder="Invoice number" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          Status
          <select name="status" defaultValue={status ?? 'all'} className={field}>
            <option value="all">All</option>
            <option value="paid">Paid</option>
            <option value="open">Open</option>
            <option value="void">Void</option>
            <option value="uncollectible">Uncollectible</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          From
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          To
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white"
        >
          Filter
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm">
          {invoices.length ? 'No invoices match these filters.' : 'No invoices yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-text">
              <tr>
                <th className="py-2 pr-3 font-semibold">Invoice</th>
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 font-semibold">Description</th>
                <th className="py-2 pr-3 font-semibold">Amount</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2 pr-3 font-mono text-xs">{i.number ?? 'Draft'}</td>
                  <td className="py-2 pr-3">{day(i.issuedAt)}</td>
                  <td className="py-2 pr-3">{i.description ?? '—'}</td>
                  <td className="py-2 pr-3">
                    {formatMoney(i.amountPaidCents || i.amountDueCents, i.currency.toUpperCase())}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge
                      tone={
                        i.status === 'paid'
                          ? 'success'
                          : i.status === 'open'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {i.status[0]!.toUpperCase() + i.status.slice(1)}
                    </Badge>
                  </td>
                  <td className="flex gap-3 py-2">
                    {i.hostedUrl ? (
                      <a
                        href={i.hostedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        View<span className="sr-only"> invoice {i.number} (opens Stripe)</span>
                      </a>
                    ) : null}
                    {i.pdfUrl ? (
                      <a
                        href={i.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        Download PDF<span className="sr-only"> for invoice {i.number}</span>
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

async function Reconciliation({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const issues = await reconcileCredits(db(), { userId }, workspaceId);
  if (issues.length)
    console.error(`Billing reconciliation mismatch in workspace ${workspaceId}`, issues);
  return issues.length === 0 ? (
    <Alert tone="success">Every paid purchase matches the credits added to your workspace.</Alert>
  ) : (
    <Alert tone="error">
      {issues.length} {issues.length === 1 ? 'payment does' : 'payments do'} not match the credits
      added ({issues.map((i) => i.description).join(', ')}). Please contact support so we can
      correct it.
    </Alert>
  );
}
