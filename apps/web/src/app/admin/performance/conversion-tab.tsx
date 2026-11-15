import {
  UserCheck,
  CreditCard,
  PenLine,
  Repeat,
  Building2,
  CircleSlash,
  RotateCcw,
  MousePointerClick,
} from 'lucide-react';
import { getPerfConversion, getPerfMeasurement, ppChange, rate } from '@st/core';
import { db } from '@/lib/db';
import { Kpi } from '@/components/admin/kpi';
import { Funnel, NotTracked, Panel } from '@/components/admin/charts';
import { Stat, TrackedSince, fmtTime, nf, pct } from '../sections';
import type { TabProps } from './page';

const monthLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );

export async function ConversionTab({ p, userId, cmp }: TabProps) {
  const [c, m] = await Promise.all([
    getPerfConversion(db(), { userId }, p),
    getPerfMeasurement(db(), { userId }, p),
  ]);
  const v = m.visits;
  const rn = m.renewals;
  const renewRate = rate(rn.renewed, rn.due);
  const renewRateCmp = rn.due_cmp ? rate(rn.renewed_cmp ?? 0, rn.due_cmp) : null;
  const renewChange = ppChange(renewRate, renewRateCmp);
  const fu = c.funnel;
  const sf = c.studio_funnel;
  const pf = c.paid_funnel;
  const r = c.retention;
  const subsBase = c.subscriptions.active + c.subscriptions.ended;
  const retain = (n: number, of: number) => (of ? pct(rate(n, of)) : 'Not enough time yet');

  return (
    <>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at {fmtTime(c.generated_at)} UTC. Funnels follow the people (or
        designer sessions, or organizations) who started in the selected period, up to today.
      </p>
      <section
        aria-label="Conversion numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Kpi
          label="Visitor-to-Registration"
          value={
            !v.conv_visits
              ? 'No visits yet'
              : v.conv_users > v.conv_visits
                ? 'Not enough visits'
                : pct(rate(v.conv_users, v.conv_visits))
          }
          icon={<MousePointerClick className="size-5" />}
          change={null}
          compareLabel={null}
          sub={
            v.conv_visits
              ? `${nf(v.conv_users)} accounts from ${nf(v.conv_visits)} visits`
              : 'Visit counting has just started'
          }
          info="Accounts created ÷ website visits, both counted from the later of the period start and the day visit counting began. Visits from browsers that ask not to be tracked aren't counted, so this rate runs slightly high. Not shown while there are more accounts than counted visits (for example, just after counting began)."
        />
        <Kpi
          label="Registration-to-Activation"
          value={pct(rate(fu.document_sent, fu.registered))}
          icon={<UserCheck className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(fu.document_sent)} of ${nf(fu.registered)} sent a live request`}
          info="People who registered in the period and have since sent at least one live signing request ÷ people who registered in the period."
        />
        <Kpi
          label="Free-to-Paid Conversion"
          value={pct(rate(pf.paid, pf.orgs))}
          icon={<CreditCard className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(pf.paid)} of ${nf(pf.orgs)} new organizations`}
          info="Organizations created in the period that have since made a successful payment ÷ organizations created in the period."
        />
        <Kpi
          label="Studio Purchase Conversion"
          value={pct(rate(sf.paid, sf.started))}
          icon={<PenLine className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(sf.paid)} of ${nf(sf.started)} designer sessions`}
          info="Designer sessions that started a design in the period and later completed a purchase ÷ those sessions."
        />
        <Kpi
          label="User Retention (Day 7)"
          value={retain(r.d7, r.d7_eligible)}
          icon={<Repeat className="size-5" />}
          change={null}
          compareLabel={null}
          sub={
            r.d7_eligible
              ? `${nf(r.d7)} of ${nf(r.d7_eligible)} eligible`
              : 'Nobody has reached day 14 yet'
          }
          info="Of the people who registered in the period and signed up at least 14 days ago, the share active between day 7 and day 13."
        />
        <Kpi
          label="Organization Retention"
          value={
            c.orgs.active_cmp != null
              ? retain(c.orgs.retained ?? 0, c.orgs.active_cmp)
              : 'Needs a comparison'
          }
          icon={<Building2 className="size-5" />}
          change={null}
          compareLabel={null}
          sub={
            c.orgs.active_cmp != null
              ? `${nf(c.orgs.retained ?? 0)} of ${nf(c.orgs.active_cmp)} stayed active`
              : undefined
          }
          info="Organizations active in the comparison period that were active again in this period ÷ organizations active in the comparison period."
        />
        <Kpi
          label="Subscription Churn (now)"
          value={
            subsBase
              ? pct(rate(c.subscriptions.cancelling + c.subscriptions.ended, subsBase))
              : 'No subscriptions'
          }
          icon={<CircleSlash className="size-5" />}
          change={null}
          compareLabel={null}
          goodWhenUp={false}
          sub={`${nf(c.subscriptions.cancelling)} set to cancel · ${nf(c.subscriptions.ended)} ended`}
          info="A snapshot today, not for the period: billing keeps each subscription's current state only. Set to cancel = still active until the period ends. Ended = cancelled, expired or unpaid."
        />
        <Kpi
          label="Recovered Customers"
          value={c.orgs.recovered != null ? nf(c.orgs.recovered) : 'Needs a comparison'}
          icon={<RotateCcw className="size-5" />}
          change={null}
          compareLabel={null}
          info="Organizations active in this period that weren't active in the comparison period but had been active before it."
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Sign-up Conversion"
          info="People who registered in the period, and how far they have got since."
        >
          <Funnel
            caption="Sign-up conversion funnel"
            steps={[
              {
                label: 'Website visit',
                value: v.since && new Date(v.since) <= p.from ? v.total : null,
              },
              { label: 'Registered', value: fu.registered },
              { label: 'Joined a workspace', value: fu.workspace },
              { label: 'Created a document', value: fu.document_created },
              { label: 'Sent a live request', value: fu.document_sent },
              { label: 'Sent two or more', value: fu.repeat },
            ]}
          />
        </Panel>
        <Panel
          title="Signature Studio Conversion"
          info="Designer sessions that started a design in the period, and the furthest each got. Customized = picked a font, stroke or variation."
        >
          <Funnel
            caption="Signature Studio conversion funnel"
            unit="sessions"
            steps={[
              { label: 'Designer started', value: sf.started },
              { label: 'Signature customized', value: sf.customized },
              { label: 'Sign-in or registration', value: sf.auth },
              { label: 'Checkout started', value: sf.checkout },
              { label: 'Payment verified', value: sf.paid },
              { label: 'Download completed', value: sf.downloaded },
            ]}
          />
          <p className="text-xs text-slate-text">{nf(sf.visited)} Studio visits in the period.</p>
        </Panel>
        <Panel
          title="Paid Conversion"
          info="Organizations created in the period. Signature Tender is pay as you go with optional plans, so there is no trial step."
        >
          <Funnel
            caption="Paid conversion funnel"
            unit="organizations"
            steps={[
              { label: 'New organization', value: pf.orgs },
              { label: 'Sent a live request', value: pf.used },
              { label: 'First payment', value: pf.paid },
              { label: 'Repeat payment', value: pf.repeat },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Retention"
          info="Only people who have passed the whole window are counted, so recent sign-ups don't drag the rate down. D1 = active 24–48 hours after sign-up; D7 = days 7–13; D30 = days 30–59."
        >
          <dl className="grid grid-cols-3 gap-2">
            {[
              ['Day 1', r.d1, r.d1_eligible],
              ['Day 7', r.d7, r.d7_eligible],
              ['Day 30', r.d30, r.d30_eligible],
            ].map(([l, n, of]) => (
              <div key={l as string} className="rounded-xl border border-border bg-ivory p-3">
                <dt className="text-xs font-semibold text-heading">{l}</dt>
                <dd className="font-display text-2xl text-heading">
                  {(of as number) ? pct(rate(n as number, of as number)) : '—'}
                </dd>
                <dd className="text-[11px] text-slate-text">
                  {(of as number)
                    ? `${nf(n as number)} of ${nf(of as number)}`
                    : 'Window not reached'}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel
          className="xl:col-span-2"
          title="Monthly Cohort Retention"
          info="Each row is the people who signed up that month; each column is the share active in a later month (month 0 = the sign-up month). Months that haven't happened yet are blank. Cohorts with fewer than 5 people are hidden."
        >
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label="Monthly cohort retention"
          >
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Monthly cohort retention</caption>
              <thead className="text-xs text-slate-text">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Cohort
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    People
                  </th>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <th key={i} scope="col" className="py-2 pr-3 text-right font-semibold">
                      Month {i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {c.cohorts.map((row) => (
                  <tr key={row.month}>
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {monthLabel(row.month)}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.suppressed ? (row.size ? 'Fewer than 5' : '0') : nf(row.size)}
                    </td>
                    {[0, 1, 2, 3, 4, 5].map((i) => {
                      const v = row.retained?.[i];
                      const share = v != null ? rate(v, row.size) : null;
                      return (
                        <td
                          key={i}
                          className="py-2 pr-3 text-right tabular-nums"
                          style={
                            share != null
                              ? { background: `rgba(13, 27, 51, ${(share / 100) * 0.35})` }
                              : undefined
                          }
                        >
                          {share != null ? `${share.toFixed(0)}%` : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Panel
          title="Subscriptions now"
          info="Current state from billing, not limited to the selected period. Changes during the period are under Subscription Changes."
        >
          <dl className="grid grid-cols-3 gap-2 text-sm">
            {[
              ['Active', c.subscriptions.active],
              ['Set to cancel', c.subscriptions.cancelling],
              ['Ended', c.subscriptions.ended],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border border-border px-2 py-1.5">
                <dt className="text-xs">{l}</dt>
                <dd className="font-semibold text-heading">{nf(v as number)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel
          title="Renewal Rate"
          info="Renewals due = subscription renewal invoices first raised in the period. Renewed = paid, including after a failed first attempt. Recorded from Stripe as it happens; earlier paid renewals were carried over from invoice history."
        >
          <TrackedSince since={rn.since} what="Subscription events" />
          <dl className="grid grid-cols-2 gap-2">
            <Stat
              label="Renewal rate"
              value={rn.due ? pct(renewRate) : 'None due'}
              note={
                renewChange != null && cmp
                  ? `${renewChange > 0 ? '+' : ''}${renewChange.toFixed(1)} pp vs. ${cmp.toLowerCase()}`
                  : `${nf(rn.renewed)} of ${nf(rn.due)} renewed`
              }
            />
            <Stat
              label="Failed first try"
              value={nf(rn.failed)}
              note={`${nf(rn.recovered)} paid later`}
            />
          </dl>
        </Panel>
        <NotTracked
          label="Re-engagement"
          reason="Win-back campaigns aren't tracked; see Recovered Customers for organizations that came back."
        />
        <Panel
          title="Subscription Changes"
          info="Subscription lifecycle events in the selected period, recorded from Stripe as they happen."
        >
          <TrackedSince since={rn.since} what="Subscription events" />
          <dl className="grid grid-cols-2 gap-2">
            <Stat label="Started" value={nf(rn.started)} />
            <Stat label="Ended" value={nf(rn.ended)} />
            <Stat label="Cancellation requested" value={nf(rn.cancel_requested)} />
            <Stat label="Cancellation withdrawn" value={nf(rn.cancel_withdrawn)} />
          </dl>
        </Panel>
      </div>
    </>
  );
}
