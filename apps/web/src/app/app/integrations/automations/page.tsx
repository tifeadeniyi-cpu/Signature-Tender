import Link from 'next/link';
import { automationStats, listConnections, readDriveSettings } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { Badge } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { AppMark } from '@/components/integrations/ui';

export const metadata = { title: 'Automations' };

const fmt = (d: Date | string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(d),
      )
    : 'Never';

/**
 * Automations configured through connected apps. Signature Tender runs only its own sync rules;
 * multi-step workflows belong in Zapier or Make once those apps launch.
 */
export default async function AutomationsPage() {
  const { user, membership } = await requireWorkspace();
  const actor = { userId: user.id };
  const ws = membership.workspace.id;
  const conns = await listConnections(db(), actor, ws);
  const drive = conns.find((c) => c.provider === 'google_drive' && c.status !== 'disabled');
  const slack = conns.find((c) => c.provider === 'slack' && c.status === 'active');
  const stats = drive ? await automationStats(db(), actor, ws, drive.id, 'save_signed_copy') : null;
  const rules = [
    ...(drive
      ? [
          {
            key: 'drive',
            app: 'Google Drive',
            name: 'Save signed documents to Google Drive',
            trigger: 'Document completed and sealed',
            action: `Save the signed PDF${readDriveSettings(drive.settings).saveCertificate ? ' and Certificate of Completion' : ''} to ${readDriveSettings(drive.settings).folderName ?? 'the Signature Tender folder'}`,
            enabled: readDriveSettings(drive.settings).autoSave && drive.status === 'active',
            last: stats?.last ?? null,
            total: stats?.total ?? 0,
            failed: stats?.failed ?? 0,
            href: '/app/integrations/google_drive',
          },
        ]
      : []),
    ...(slack
      ? [
          {
            key: 'slack',
            app: 'Slack',
            name: 'Post document updates to Slack',
            trigger: 'Document sent, signed, completed, declined, expired or cancelled',
            action: 'Post a message with the title and a link',
            enabled: slack.webhookEnabled !== false,
            last: null,
            total: null,
            failed: slack.failedDeliveries,
            href: '/app/integrations/slack',
          },
        ]
      : []),
  ];
  if (!rules.length)
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center">
        <p className="mb-1 text-sm">No automations yet.</p>
        <p className="mb-4 text-sm">
          Connect Google Drive to save signed copies automatically, or Slack to post updates.
        </p>
        <Link href="/app/integrations" className={buttonClass('gold', 'md')}>
          Discover integrations
        </Link>
      </div>
    );
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {rules.map((r) => (
        <li key={r.key} className="rounded-2xl border border-border bg-white p-5 shadow-card">
          <div className="mb-3 flex items-start gap-3">
            <AppMark name={r.app} />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg leading-tight">{r.name}</h2>
              <p className="text-xs">{r.app}</p>
            </div>
            <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Enabled' : 'Off'}</Badge>
          </div>
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-semibold text-heading">When</dt>
            <dd>{r.trigger}</dd>
            <dt className="font-semibold text-heading">Then</dt>
            <dd>{r.action}</dd>
            <dt className="font-semibold text-heading">Last run</dt>
            <dd>{fmt(r.last)}</dd>
            {r.total !== null ? (
              <>
                <dt className="font-semibold text-heading">Runs</dt>
                <dd>{r.total}</dd>
              </>
            ) : null}
            <dt className="font-semibold text-heading">Errors</dt>
            <dd className={r.failed ? 'font-semibold text-error' : ''}>
              {r.failed ? `${r.failed} failed` : 'None'}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link href={r.href} className={buttonClass('secondary', 'sm')}>
              {r.enabled ? 'Edit' : 'Turn on'}
            </Link>
            <Link
              href={`/app/integrations/activity?provider=${r.key === 'drive' ? 'google_drive' : 'slack'}`}
              className={buttonClass('ghost', 'sm')}
            >
              View activity
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
