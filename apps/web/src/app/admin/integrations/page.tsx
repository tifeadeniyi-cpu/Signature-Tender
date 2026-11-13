import { CONNECTORS, getAvailabilityOverrides, getIntegrationAdminOverview } from '@st/core';
import { Card } from '@/components/ui/card';
import { db } from '@/lib/db';
import { requireStaff } from '@/lib/session';
import { oauthClientFor } from '@/lib/integrations';
import { AvailabilityForm } from './availability-form';

export const metadata = { title: 'Integrations' };

export default async function AdminIntegrationsPage() {
  const staff = await requireStaff();
  const [overview, overrides] = await Promise.all([
    getIntegrationAdminOverview(db(), { userId: staff.id }),
    getAvailabilityOverrides(db()),
  ]);
  const stats = new Map(overview.map((r) => [r.provider, r]));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl text-heading">Integrations</h1>
        <p className="text-sm">
          Availability, connection health and usage per app. Counts only: customer accounts, tokens
          and agreements are never shown here. Changes are audited. Apps that are not built stay
          Coming Soon whatever is set.
        </p>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-border bg-cream text-xs uppercase tracking-wide text-heading">
            <tr>
              <th scope="col" className="px-4 py-3">
                App
              </th>
              <th scope="col" className="px-4 py-3">
                Built
              </th>
              <th scope="col" className="px-4 py-3">
                Provider app
              </th>
              <th scope="col" className="px-4 py-3">
                Connections
              </th>
              <th scope="col" className="px-4 py-3">
                Needs attention
              </th>
              <th scope="col" className="px-4 py-3">
                Jobs 7d (ok / failed)
              </th>
              <th scope="col" className="px-4 py-3">
                Envelopes 30d
              </th>
              <th scope="col" className="px-4 py-3">
                Availability
              </th>
            </tr>
          </thead>
          <tbody>
            {CONNECTORS.map((c) => {
              const s = stats.get(c.key);
              const configured =
                c.auth.type !== 'oauth2'
                  ? 'Not needed'
                  : oauthClientFor(c.key)
                    ? 'Configured'
                    : 'Missing';
              return (
                <tr key={c.key} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-semibold text-heading">
                    {c.name}
                    <span className="block text-xs font-normal">{c.category}</span>
                  </td>
                  <td className="px-4 py-3">
                    {c.implemented ? 'Yes' : `No (phase ${c.roadmapPhase})`}
                  </td>
                  <td className="px-4 py-3">{configured}</td>
                  <td className="px-4 py-3">
                    {s ? `${s.active} active of ${s.connections}` : '0'}
                  </td>
                  <td className="px-4 py-3">{s?.needs_attention ?? 0}</td>
                  <td className="px-4 py-3">
                    {s ? `${s.jobs_succeeded_7d} / ${s.jobs_failed_7d}` : '0 / 0'}
                  </td>
                  <td className="px-4 py-3">{s?.envelopes_linked_30d ?? 0}</td>
                  <td className="px-4 py-3">
                    <AvailabilityForm
                      provider={c.key}
                      name={c.name}
                      current={
                        typeof overrides[c.key] === 'string'
                          ? (overrides[c.key] as string)
                          : 'default'
                      }
                      locked={!c.implemented}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
