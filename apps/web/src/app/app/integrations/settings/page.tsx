import { getConnector, integrationUsage, listIntegrationConnections } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { integrationPermissions } from '@/lib/integrations-view';
import { Card } from '@/components/ui/card';
import { AppLogo } from '../_components/badges';
import { ConnectionSettingsForm, type SettingField } from '../_components/connection-forms';

export const metadata = { title: 'Integration settings' };

/** Settings shown only for what each connector supports. */
function fieldsFor(provider: string): SettingField[] {
  const def = getConnector(provider);
  if (!def?.implemented) return [];
  const f: SettingField[] = [];
  if (def.capabilities.includes('save_signed'))
    f.push(
      {
        key: 'autoSave',
        label: 'Save signed documents automatically',
        type: 'checkbox',
        hint: 'Off by default. Signed agreements are copied to the app only when this is on.',
      },
      {
        key: 'saveCertificate',
        label: 'Also save the Certificate of Completion',
        type: 'checkbox',
      },
      {
        key: 'saveCombined',
        label: 'Save one combined PDF (agreement + certificate)',
        type: 'checkbox',
      },
      {
        key: 'folder',
        label: 'Destination folder',
        type: 'text',
        hint: 'Where signed files go in the connected app.',
      },
      {
        key: 'naming',
        label: 'File naming',
        type: 'text',
        hint: 'For example {title} - signed {date}.',
      },
    );
  if (def.capabilities.includes('update_records'))
    f.push({
      key: 'updateOnComplete',
      label: 'Update the linked record when the agreement completes',
      type: 'checkbox',
      hint: 'Nothing is changed in the app unless this is on.',
    });
  return f;
}

const PERMS: [string, string][] = [
  ['View Integrations', 'Everyone in the workspace'],
  [
    'Connect Apps',
    'Owners, admins and API developers for the workspace; members with “use integrations” for their own personal accounts',
  ],
  [
    'Manage Connections',
    'Owners, admins and API developers; members manage their own personal connections',
  ],
  ['Create Automations', 'Whoever can manage the connection'],
  ['Configure Sync Rules', 'Whoever can manage the connection'],
  [
    'Access Integration Logs',
    'Owners, admins and API developers see everything; members see their own activity',
  ],
  ['Manage Billing', 'Billing managers, on the Billing & Credits page'],
];

export default async function IntegrationSettingsPage() {
  const { user, membership } = await requireWorkspace();
  const perms = integrationPermissions(membership);
  const actor = { userId: user.id };
  const [conns, usage] = await Promise.all([
    listIntegrationConnections(db(), actor, membership.workspace.id),
    perms.viewLogs || perms.manage
      ? integrationUsage(db(), actor, membership.workspace.id, 30)
      : Promise.resolve([]),
  ]);
  const withSettings = conns.filter((c) => c.status !== 'disabled' && fieldsFor(c.provider).length);

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="mb-1 font-display text-xl">Sync settings</h2>
        {withSettings.length === 0 ? (
          <p className="text-sm">
            Settings appear here for connected apps that have them, such as the destination folder
            for signed copies. Nothing is copied to another app until you turn it on.
          </p>
        ) : (
          <ul className="mt-4 grid gap-6">
            {withSettings.map((c) => {
              const def = getConnector(c.provider)!;
              return (
                <li key={c.id} id={c.id} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <AppLogo name={def.name} logo={def.logo} />
                    <div>
                      <h3 className="font-semibold text-heading">{def.name}</h3>
                      <p className="text-xs">{c.externalAccountLabel}</p>
                    </div>
                  </div>
                  <ConnectionSettingsForm
                    id={c.id}
                    fields={fieldsFor(c.provider)}
                    values={c.settings}
                    canEdit={perms.manage || c.ownerUserId === user.id}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {perms.viewLogs || perms.manage ? (
        <Card>
          <h2 className="mb-1 font-display text-xl">Usage by integration</h2>
          <p className="mb-3 text-sm">
            Envelopes sent through connected apps in the last 30 days. They are charged like any
            other send, on the Billing &amp; Credits page; syncs, retries and drafts are never
            charged.
          </p>
          {usage.length === 0 ? (
            <p className="text-sm">No envelopes have been sent through an integration yet.</p>
          ) : (
            <table className="w-full max-w-lg text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-heading">
                <tr>
                  <th scope="col" className="py-2">
                    Integration
                  </th>
                  <th scope="col" className="py-2">
                    Sent
                  </th>
                  <th scope="col" className="py-2">
                    Completed
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.provider} className="border-t border-border">
                    <td className="py-2">{getConnector(u.provider)?.name ?? u.provider}</td>
                    <td className="py-2">{u.envelopes}</td>
                    <td className="py-2">{u.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 font-display text-xl">Who can do what</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
          {PERMS.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold text-heading">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs">
          Roles are managed on the Team page. Every rule is also enforced by the server.
        </p>
      </Card>
    </div>
  );
}
