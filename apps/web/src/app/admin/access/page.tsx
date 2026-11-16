import { listAdminStaff } from '@st/core';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';

export const metadata = { title: 'Admin Access' };

const fmt = (d: Date | string | null) =>
  d
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(d))
    : '—';

const ROLES: { role: string; label: string; can: string }[] = [
  {
    role: 'founder',
    label: 'Founder / Owner',
    can: 'Every admin area: analytics, revenue, audit, security, system health, settings. No access to customer documents or signatures.',
  },
  { role: 'finance', label: 'Finance', can: 'Analytics and revenue.' },
  { role: 'support', label: 'Support', can: 'Support tools only.' },
  {
    role: 'security',
    label: 'Security',
    can: 'Analytics, audit trail, security, system health, staff list.',
  },
  {
    role: 'technical',
    label: 'Technical',
    can: 'Analytics, system health, platform settings and operations.',
  },
  {
    role: 'analyst',
    label: 'Read-only analyst',
    can: 'Aggregate analytics only. The default for a new grant.',
  },
];

export default async function AdminAccessPage() {
  const { user } = await requireAdmin('access.view', 'access');
  const staff = await listAdminStaff(db(), { userId: user.id });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl">Admin Access</h1>
        <p className="mt-1 text-sm">
          Who can open this portal and what their role allows. Staff must use two-factor sign-in or
          a passkey, and staff sessions end after 12 hours.
        </p>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">Staff accounts</caption>
          <thead className="bg-ivory text-xs uppercase tracking-wide text-slate-text">
            <tr>
              {['Name', 'Email', 'Role', 'Sign-in protection', 'Granted', 'Last sign-in'].map(
                (h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.user_id} className="border-t border-border/60">
                <td className="px-3 py-2 font-medium text-heading">{s.name}</td>
                <td className="px-3 py-2">{s.email}</td>
                <td className="px-3 py-2">
                  {ROLES.find((r) => r.role === s.role)?.label ?? s.role}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={s.strong_sign_in ? 'success' : 'error'}>
                    {s.passkeys ? 'Passkey' : s.strong_sign_in ? 'Two-factor' : 'Password only'}
                  </Badge>
                </td>
                <td className="px-3 py-2">{fmt(s.granted_at)}</td>
                <td className="px-3 py-2">{fmt(s.last_sign_in)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader
          title="Roles"
          description="Granting or changing a role is done by the database owner and is recorded. See docs/operations/admin.md."
        />
        <dl className="grid gap-3 sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.role} className="rounded-lg border border-border px-3 py-2 text-sm">
              <dt className="font-semibold text-heading">{r.label}</dt>
              <dd className="mt-0.5">{r.can}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
