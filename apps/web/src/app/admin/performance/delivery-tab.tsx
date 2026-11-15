import { FilePlus, Send, CircleCheck, Percent, Timer, Cog, PenTool, Award } from 'lucide-react';
import { getPerfDelivery, pctChange, rate } from '@st/core';
import { db } from '@/lib/db';
import { Kpi } from '@/components/admin/kpi';
import {
  ColumnChart,
  Legend,
  NotTracked,
  Panel,
  ProgressBars,
  SERIES,
} from '@/components/admin/charts';
import { DataTable } from '@/components/admin/data-table';
import { StatusPanel, bucketLabel, fmtTime, nf, pct } from '../sections';
import type { TabProps } from './page';

const SERVICE: Record<string, string> = {
  finishing: 'Document finishing',
  webhook: 'Webhook delivery',
  email: 'Email',
  integration_sync: 'Integration sync',
};
const hours = (h: number | null) =>
  h == null
    ? '—'
    : h < 1
      ? `${Math.round(h * 60)} min`
      : h < 48
        ? `${h.toFixed(1)} h`
        : `${(h / 24).toFixed(1)} days`;

export async function DeliveryTab({ p, userId, cmp }: TabProps) {
  const d = await getPerfDelivery(db(), { userId }, p);
  const k = d.kpi;
  const labels = d.series.map((s) => bucketLabel(s.start, p.bucket));
  const rel = d.reliability;
  const ct = d.completion_time;

  return (
    <>
      <p className="-mt-3 text-xs text-slate-text">
        Live from the database at {fmtTime(d.generated_at)} UTC. Live requests only; test requests
        are excluded. No document, signer or file is shown here.
      </p>
      <section
        aria-label="Delivery numbers"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Kpi
          label="Documents Created"
          value={nf(k.created)}
          icon={<FilePlus className="size-5" />}
          change={pctChange(k.created, k.created_cmp)}
          compareLabel={cmp}
          info="Documents uploaded or created from a template in the period, sent or not."
        />
        <Kpi
          label="Documents Sent"
          value={nf(k.sent)}
          icon={<Send className="size-5" />}
          change={pctChange(k.sent, k.sent_cmp)}
          compareLabel={cmp}
          info="Live signing requests sent in the period."
        />
        <Kpi
          label="Documents Completed"
          value={nf(k.completed)}
          icon={<CircleCheck className="size-5" />}
          change={pctChange(k.completed, k.completed_cmp)}
          compareLabel={cmp}
          info="Live requests that finished in the period."
        />
        <Kpi
          label="Completion Rate"
          value={pct(rate(k.cohort_completed, k.sent))}
          icon={<Percent className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(k.cohort_completed)} of ${nf(k.sent)} sent`}
          info="Of the live requests sent in the period, the share now completed."
        />
        <Kpi
          label="Time to Complete (median)"
          value={hours(k.median_hours)}
          icon={<Timer className="size-5" />}
          change={null}
          compareLabel={null}
          goodWhenUp={false}
          sub={
            k.avg_hours != null ? `Average ${hours(k.avg_hours)}` : 'No completions in the period'
          }
          info="From sending to the last signature, for requests completed in the period. The median is less affected by a few slow requests."
        />
        <Kpi
          label="Processing Success Rate"
          value={
            k.finalized_ok + k.finalized_failed
              ? pct(rate(k.finalized_ok, k.finalized_ok + k.finalized_failed))
              : '—'
          }
          icon={<Cog className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(k.finalized_failed)} finishing failures`}
          info="Requests finished into a signed copy and certificate ÷ requests that reached finishing in the period (finished plus failed)."
        />
        <Kpi
          label="Signing Session Success"
          value={k.signing_started ? pct(rate(k.signing_signed, k.signing_started)) : '—'}
          icon={<PenTool className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(k.signing_signed)} signed · ${nf(k.signing_declined)} declined`}
          info="Recipients who opened a signing link in the period and have signed ÷ recipients who opened one. Recipients are counted, never named."
        />
        <Kpi
          label="Certificates Generated"
          value={nf(k.certificates)}
          icon={<Award className="size-5" />}
          change={null}
          compareLabel={null}
          sub={`${nf(k.certificates_reissued)} re-issued`}
          info="Certificates of Completion issued in the period. Re-issued = existing completed requests given the new certificate by staff."
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Document Processing Volume"
          info="Documents created, live requests sent and live requests completed, per interval."
        >
          <Legend
            items={[
              { label: 'Created', color: SERIES.gold },
              { label: 'Sent', color: SERIES.blue },
              { label: 'Completed', color: SERIES.navy },
            ]}
          />
          <ColumnChart
            caption="Documents created, sent and completed per interval"
            labels={labels}
            series={[
              { name: 'Created', color: SERIES.gold, values: d.series.map((s) => s.created) },
              { name: 'Sent', color: SERIES.blue, values: d.series.map((s) => s.sent) },
              { name: 'Completed', color: SERIES.navy, values: d.series.map((s) => s.completed) },
            ]}
          />
        </Panel>
        <StatusPanel status={d.status} />
        <Panel
          title="Processing Success vs Failure"
          info="Requests finished into a signed copy versus requests whose finishing failed, per interval."
        >
          <Legend
            items={[
              { label: 'Finished', color: SERIES.green },
              { label: 'Failed', color: SERIES.burgundy },
            ]}
          />
          <ColumnChart
            caption="Finished and failed requests per interval"
            labels={labels}
            series={[
              { name: 'Finished', color: SERIES.green, values: d.series.map((s) => s.completed) },
              { name: 'Failed', color: SERIES.burgundy, values: d.series.map((s) => s.failed) },
            ]}
          />
        </Panel>
        <Panel
          title="Signing Completion Time"
          info="How long requests completed in the period took, from sending to the last signature."
        >
          <ColumnChart
            caption="Completed requests by time to complete"
            labels={['< 1 hour', '1–24 hours', '1–3 days', '3–7 days', '7+ days']}
            series={[
              {
                name: 'Requests',
                color: SERIES.navy,
                values: [ct.under_1h, ct.under_1d, ct.under_3d, ct.under_7d, ct.over_7d],
              },
            ]}
          />
        </Panel>
        <Panel
          title="Certificate Generation"
          info="Certificates issued, finishing failures, and staff re-issues, per interval."
        >
          <Legend
            items={[
              { label: 'Generated', color: SERIES.navy },
              { label: 'Failed', color: SERIES.burgundy },
              { label: 'Re-issued', color: SERIES.gold },
            ]}
          />
          <ColumnChart
            caption="Certificates generated, failed and re-issued per interval"
            labels={labels}
            series={[
              {
                name: 'Generated',
                color: SERIES.navy,
                values: d.series.map((s) => s.certificates),
              },
              { name: 'Failed', color: SERIES.burgundy, values: d.series.map((s) => s.failed) },
              { name: 'Re-issued', color: SERIES.gold, values: d.series.map((s) => s.reissued) },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel
          title="Delivery Reliability"
          info="Success rate of each delivery path in the period. Emails: sent or delivered ÷ attempted. Webhooks: succeeded ÷ finished (succeeded, failed or gave up). Finishing: finished ÷ reached finishing. Integration sync: succeeded ÷ finished jobs."
        >
          <ProgressBars
            rows={[
              ['Invitation emails', rel.emails_ok, rel.emails_total],
              ['Webhook deliveries', rel.webhooks_ok, rel.webhooks_total],
              ['Document finishing', rel.finalization_ok, rel.finalization_total],
              ['Integration sync', rel.sync_ok, rel.sync_total],
            ]
              .filter(([, , t]) => (t as number) > 0)
              .map(([l, ok, t]) => ({
                label: l as string,
                value: rate(ok as number, t as number) ?? 0,
                detail: `${nf(ok as number)} of ${nf(t as number)}`,
              }))}
            empty="Nothing was delivered in the selected period."
          />
          <p className="text-xs text-slate-text">
            File conversion isn&apos;t tracked as a separate step.
          </p>
        </Panel>
        <Panel
          className="xl:col-span-2"
          title="Signing Reliability"
          info="Recipients who opened a signing link in each interval, and what they did. Average time is from opening the link to signing."
        >
          <DataTable
            caption="Signing reliability"
            columns={[
              { key: 'period', label: 'Period' },
              { key: 'started', label: 'Sessions Started', numeric: true },
              { key: 'signed', label: 'Signed', numeric: true },
              { key: 'declined', label: 'Declined', numeric: true },
              { key: 'minutes', label: 'Avg Minutes to Sign', numeric: true },
            ]}
            rows={d.series.map((s, i) => ({
              period: labels[i]!,
              started: s.signing_started,
              signed: s.signing_signed,
              declined: s.signing_declined,
              minutes: s.signing_minutes,
            }))}
          />
        </Panel>
      </div>

      <Panel
        title="Certificate Reliability"
        info="Per interval: requests completed (finalized), certificates generated, and finishing failures. Public verification failures aren't recorded."
      >
        <DataTable
          caption="Certificate reliability"
          columns={[
            { key: 'period', label: 'Period' },
            { key: 'finalized', label: 'Finalized Agreements', numeric: true },
            { key: 'certs', label: 'Certificates Generated', numeric: true },
            { key: 'failed', label: 'Certificate Failures', numeric: true },
            { key: 'reissued', label: 'Re-issued', numeric: true },
          ]}
          rows={d.series.map((s, i) => ({
            period: labels[i]!,
            finalized: s.completed,
            certs: s.certificates,
            failed: s.failed,
            reissued: s.reissued,
          }))}
        />
      </Panel>

      {d.failures ? (
        <Panel
          title="Processing Failures"
          info="The latest 50 failures in the period. Sanitized: a reference, the service, an error category, status and attempts. Error messages, documents and recipients are never shown."
        >
          <DataTable
            caption="Processing failures"
            searchable
            columns={[
              { key: 'ref', label: 'Reference' },
              { key: 'service', label: 'Service' },
              { key: 'category', label: 'Error Category' },
              { key: 'at', label: 'When (UTC)' },
              { key: 'status', label: 'Status' },
              { key: 'attempts', label: 'Attempts', numeric: true },
            ]}
            rows={d.failures.map((f) => ({
              ref: f.ref,
              service: SERVICE[f.service] ?? f.service,
              category: f.category.replace(/_/g, ' '),
              at: fmtTime(f.at),
              status:
                f.status === 'gave_up' ? 'Gave up' : f.status === 'retrying' ? 'Retrying' : 'Open',
              attempts: f.attempts,
            }))}
          />
        </Panel>
      ) : (
        <NotTracked
          label="Processing Failures"
          reason="The failure list is shown to technical, security and founder roles."
        />
      )}
    </>
  );
}
