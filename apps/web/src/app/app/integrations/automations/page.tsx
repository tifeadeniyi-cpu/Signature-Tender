import { Workflow, TriangleAlert } from 'lucide-react';
import { getConnector, listAutomations } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { integrationPermissions } from '@/lib/integrations-view';
import { EmptyState } from '@/components/ui/feedback';
import { ButtonLink } from '@/components/ui/button';
import { AppLogo, fmtDate } from '../_components/badges';
import { AutomationButtons } from '../_components/connection-forms';

export const metadata = { title: 'Automations' };

const EVENT_LABEL: Record<string, string> = {
  'request.sent': 'Envelope sent',
  'request.completed': 'Envelope completed',
  'request.declined': 'Envelope declined',
  'request.expired': 'Envelope expired',
  'request.cancelled': 'Envelope voided',
  'recipient.viewed': 'Recipient viewed',
  'recipient.signed': 'Recipient signed',
  'document.available': 'Signed document ready',
  'document.finalized': 'Document finalized',
};

export default async function AutomationsPage() {
  const { user, membership } = await requireWorkspace();
  const perms = integrationPermissions(membership);
  const rows = await listAutomations(db(), { userId: user.id }, membership.workspace.id);

  return (
    <>
      <p className="mb-6 max-w-3xl text-sm">
        Automations run a connected app&rsquo;s action when something happens in Signature Tender,
        for example saving a signed copy to a folder when an envelope completes. For multi-step
        workflows across many apps, use Zapier or Make once they are available.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Workflow className="size-5" />}
          title="No automations yet"
          action={
            <ButtonLink href="/app/integrations" variant="secondary">
              Browse integrations
            </ButtonLink>
          }
        >
          Automations become available as apps like Google Drive and HubSpot are connected. You set
          them up from the connected app.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {rows.map((a) => {
            const def = getConnector(a.provider);
            const action = def?.actions.find((x) => x.key === a.action);
            return (
              <li key={a.id}>
                <article
                  className="rounded-2xl border border-border bg-white p-5 shadow-card"
                  aria-label={a.name}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <AppLogo name={def?.name ?? a.provider} logo={def?.logo ?? null} />
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-lg leading-tight">{a.name}</h2>
                      <p className="text-sm">
                        {def?.name ?? a.provider} · {a.connectionLabel}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${a.enabled ? 'bg-success-bg text-success' : 'bg-cream text-slate-text'}`}
                    >
                      {a.enabled ? 'On' : 'Off'}
                    </span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="font-semibold text-heading">When</dt>
                    <dd>{EVENT_LABEL[a.eventType] ?? a.eventType}</dd>
                    <dt className="font-semibold text-heading">Then</dt>
                    <dd>{action?.label ?? a.action}</dd>
                    <dt className="font-semibold text-heading">Last run</dt>
                    <dd>{fmtDate(a.lastRunAt)}</dd>
                    <dt className="font-semibold text-heading">Runs</dt>
                    <dd>
                      {a.runCount}
                      {a.failureCount ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-error">
                          <TriangleAlert className="size-3.5" aria-hidden />
                          {a.failureCount} failed
                        </span>
                      ) : null}
                    </dd>
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <ButtonLink
                      href={`/app/integrations/activity?connection=${a.connectionId}`}
                      variant="ghost"
                      size="sm"
                    >
                      View activity
                    </ButtonLink>
                    {perms.manage || perms.use ? (
                      <AutomationButtons id={a.id} enabled={a.enabled} name={a.name} />
                    ) : null}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
