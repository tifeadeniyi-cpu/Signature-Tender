import Link from 'next/link';
import { Download, ShieldCheck, ShieldAlert, CircleDashed } from 'lucide-react';
import { COMPARE_LABEL, getCommandCenter, rate, resolvePeriod } from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { Panel } from '@/components/admin/charts';
import { PeriodFilter } from '@/components/admin/period-filter';
import {
  DocTypesPanel,
  FeaturesPanel,
  GrowthPanel,
  KpiRow,
  RevenuePanel,
  StatusPanel,
  StudioPanel,
  Toggle,
  ago,
  filterParams as toParams,
  fmtTime,
  nf,
  pct,
} from './sections';

export const metadata = { title: 'Command Center' };

type Search = { range?: string; compare?: string; from?: string; to?: string; growth?: string };

const ACTIVITY_LABEL: Record<string, string> = {
  user_registered: 'New user registered',
  organization_registered: 'New organization registered',
  payment_request: 'Payment received: single request',
  payment_credits: 'Payment received: credit pack',
  payment_subscription: 'Payment received: subscription',
  studio_purchase: 'Signature Studio purchase',
  integration_connected: 'Integration connected',
  finalization_failed: 'Document finishing failed',
  webhook_dead: 'Webhook delivery gave up',
  payment_failed: 'Payment failed',
};

export default async function CommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const { user, access } = await requireAdmin('analytics.view', 'command_center');
  const p = resolvePeriod(sp);
  const c = await getCommandCenter(db(), { userId: user.id }, p);
  const cmp = p.compare === 'none' ? null : COMPARE_LABEL[p.compare];
  const cumulative = sp.growth === 'cumulative';
  const filterParams = toParams(p, sp);
  const h = c.health;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Platform Command Center</h1>
          <p className="mt-1 text-sm">
            Real-time insights, performance, and overall health of Signature Tender.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodFilter
            action="/admin"
            range={p.range}
            compare={p.compare}
            from={sp.from}
            to={sp.to}
            keep={sp.growth ? { growth: sp.growth } : {}}
          />
          <a
            href={`/admin/export?${filterParams}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gold px-4 text-sm font-semibold text-heading hover:bg-soft-gold"
          >
            <Download className="size-4" aria-hidden /> Export report
          </a>
        </div>
      </div>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at {fmtTime(c.generated_at)} UTC. Periods are in UTC. Test requests
        are excluded.
      </p>

      <KpiRow c={c} cmp={cmp} links={{ users: `/admin/performance?tab=growth&${filterParams}` }} />

      <div className="grid gap-6 xl:grid-cols-3">
        <GrowthPanel
          c={c}
          p={p}
          cumulative={cumulative}
          toggle={
            <Toggle
              label="Measure"
              base="/admin"
              params={new URLSearchParams(filterParams)}
              name="growth"
              value={cumulative ? 'cumulative' : 'new'}
              options={[
                ['new', 'New registrations'],
                ['cumulative', 'Cumulative'],
              ]}
            />
          }
        />
        <StatusPanel status={c.doc_status} />
        <RevenuePanel c={c} p={p} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <FeaturesPanel c={c} />
        <StudioPanel c={c} cmp={cmp} />
        <DocTypesPanel c={c} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Recent Platform Activity">
          {c.activity.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {c.activity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${a.severity === 'warning' ? 'bg-burgundy' : 'bg-success'}`}
                      aria-hidden
                    />
                    {ACTIVITY_LABEL[a.kind] ?? a.kind}
                    {a.severity === 'warning' ? (
                      <span className="sr-only"> (needs attention)</span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap text-xs text-slate-text">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No activity yet.</p>
          )}
        </Panel>

        {c.audit ? (
          <Panel
            title="Audit Trail"
            action={
              <Link
                href="/admin/audit"
                className="text-xs font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            }
          >
            {c.audit.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {c.audit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/audit?event=${a.id}`} className="truncate hover:underline">
                      <code className="font-mono text-xs">{a.action}</code>
                    </Link>
                    <span className="whitespace-nowrap text-xs text-slate-text">{ago(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">No administrative events yet.</p>
            )}
          </Panel>
        ) : null}

        <Panel
          title="Security & Compliance"
          info="The actual state of controls in the app. No certification (SOC 2, ISO 27001, PCI) is held or claimed."
        >
          <ul className="flex flex-col gap-2 text-sm">
            {[
              {
                label: 'Staff sign-in protection',
                ok: c.security.staff_strong === c.security.staff,
                value: `${c.security.staff_strong} of ${c.security.staff} staff use 2FA or a passkey`,
              },
              {
                label: 'Audit log',
                ok: c.security.audit_append_only,
                value: c.security.audit_append_only ? 'Append-only (enforced)' : 'Not enforced',
              },
              {
                label: 'Refused admin access',
                ok: c.security.denied === 0,
                value: `${nf(c.security.denied)} attempts in period`,
              },
              {
                label: 'Live signing',
                ok: true,
                value: c.security.production_signing ? 'On' : 'Off until legal review and pen test',
              },
            ].map((r) => (
              <li key={r.label} className="flex items-start gap-2">
                {r.ok ? (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-burgundy" aria-hidden />
                )}
                <span>
                  <span className="font-semibold text-heading">{r.label}</span>
                  <span className="block text-xs">{r.value}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="System Health"
          action={
            access.permissions.includes('system.view') ? (
              <Link
                href="/admin/operations"
                className="text-xs font-semibold text-primary hover:underline"
              >
                View status
              </Link>
            ) : null
          }
        >
          <div className="flex items-center gap-2 rounded-xl bg-cream px-3 py-2 text-sm">
            <CircleDashed className="size-4 text-heading" aria-hidden />
            Uptime and response time: monitoring not configured
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {[
              ['Finishing failures open', nf(h.finalization_failed)],
              [
                'Webhook success',
                h.webhooks_total ? pct(rate(h.webhooks_ok, h.webhooks_total)) : 'No deliveries',
              ],
              [
                'Email delivered',
                h.emails_total ? pct(rate(h.emails_ok, h.emails_total)) : 'No emails',
              ],
              ['Email bounces', nf(h.emails_bounced)],
              ['Stripe events waiting', nf(h.stripe_unprocessed)],
              ['Integration sync failures', nf(h.sync_failed)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-border px-2 py-1.5">
                <dt className="text-xs">{l}</dt>
                <dd className="font-semibold text-heading">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
