import Link from 'next/link';
import { Mail, ShieldCheck, UserCheck, UserMinus, Users, UsersRound } from 'lucide-react';
import { getTeam, getCardOnFile, hasPermission, PERMISSIONS, AppError } from '@st/core';
import { paymentsAvailable } from '@/lib/billing';
import { SaveCardButton } from '@/components/billing/save-card-button';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { GroupsPanel, InvitationRow, InviteForm, MemberControls, RoleEditor } from './team-client';

export const metadata = { title: 'Team' };

const TABS = [
  ['all', 'All Members'],
  ['internal', 'Internal Team'],
  ['external', 'External Collaborators'],
  ['pending', 'Pending Invites'],
  ['roles', 'Roles'],
  ['groups', 'Groups'],
] as const;
type Tab = (typeof TABS)[number][0];
const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const STATUS = {
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'warning' },
  invited: { label: 'Invited', tone: 'info' },
  removed: { label: 'Removed', tone: 'neutral' },
} as const;

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; card?: string }>;
}) {
  const { tab: raw, card: cardParam } = await searchParams;
  const tab: Tab = TABS.some(([t]) => t === raw) ? (raw as Tab) : 'all';
  const { user, membership } = await requireWorkspace();
  let team;
  try {
    team = await getTeam(db(), { userId: user.id }, membership.workspace.id);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return (
      <div>
        <PageHeader
          title="Team"
          description="Manage your team, roles, access, and signing permissions."
        />
        <Alert tone="info">
          Your role does not include viewing the team. Ask a workspace admin.
        </Alert>
      </div>
    );
  }
  // Companies keep a card on file to add team members (while payments are live).
  const card = team.canManage
    ? await getCardOnFile(db(), { userId: user.id }, membership.workspace.id)
    : null;
  const cardNeeded = Boolean(card?.required && !card.hasCard && (await paymentsAvailable()));
  const canBilling = hasPermission(membership.permissions, 'billing.manage');
  const assignable = team.roles
    .filter((r) => r.assignable)
    .map((r) => ({ id: r.id, name: r.name }));
  const members = team.members.filter((m) =>
    tab === 'internal'
      ? m.memberType === 'internal'
      : tab === 'external'
        ? m.memberType === 'external'
        : true,
  );

  return (
    <div>
      <PageHeader
        title="Team"
        description="Manage your team, roles, access, and signing permissions."
        actions={
          team.canManage && !cardNeeded ? (
            <InviteForm
              roles={assignable}
              groups={team.groups.map((g) => ({ id: g.id, name: g.name }))}
            />
          ) : null
        }
      />
      {cardParam === 'saved' ? (
        <Alert tone={cardNeeded ? 'info' : 'success'} className="mb-4">
          {cardNeeded
            ? 'Thanks. Stripe is confirming your card; refresh in a moment to invite your team.'
            : 'Card saved. You can now invite team members.'}
        </Alert>
      ) : null}
      {team.canManage && cardNeeded ? (
        <Card className="mb-6 border-gold">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-xl">
              <h2 className="font-display text-xl">Add a card to invite your team</h2>
              <p className="mt-1 text-sm">
                Companies keep a card on file before adding team members. Saving a card does not
                charge it. It is used only for payments your workspace makes.
              </p>
            </div>
            {canBilling ? (
              <SaveCardButton returnPath="/app/team" variant="gold" />
            ) : (
              <p className="text-sm font-semibold text-heading">
                Ask a workspace owner or admin to add a card in Billing.
              </p>
            )}
          </div>
        </Card>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard
          label="Total members"
          value={team.metrics.total}
          icon={<Users className="size-5" />}
        />
        <StatCard
          label="Active"
          value={team.metrics.active}
          icon={<UserCheck className="size-5" />}
        />
        <StatCard
          label="Pending invitations"
          value={team.metrics.pending}
          icon={<Mail className="size-5" />}
        />
        <StatCard
          label="Inactive"
          value={team.metrics.inactive}
          icon={<UserMinus className="size-5" />}
          hint="Suspended"
        />
        <StatCard
          label="Roles"
          value={team.metrics.roles}
          icon={<ShieldCheck className="size-5" />}
        />
        <StatCard
          label="Groups"
          value={team.metrics.groups}
          icon={<UsersRound className="size-5" />}
        />
      </div>

      <nav aria-label="Team sections" className="mb-4 overflow-x-auto">
        <ul className="flex gap-1 border-b border-border">
          {TABS.map(([t, label]) => (
            <li key={t} className="shrink-0">
              <Link
                href={t === 'all' ? '/app/team' : `/app/team?tab=${t}`}
                aria-current={tab === t ? 'page' : undefined}
                className={cn(
                  '-mb-px block border-b-2 px-3 py-2 text-sm',
                  tab === t
                    ? 'border-primary font-semibold text-primary-dark'
                    : 'border-transparent text-heading hover:border-border',
                )}
              >
                {label}
                {t === 'pending' && team.invitations.length ? ` (${team.invitations.length})` : ''}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'pending' ? (
        team.invitations.length === 0 ? (
          <EmptyState icon={<Mail className="size-5" />} title="No open invitations">
            Invitations you send appear here until they are accepted, cancelled or expire.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-card">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Pending invitations</caption>
              <thead className="border-b border-border bg-blush/40 text-xs uppercase tracking-wide text-heading">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Team
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Invited by
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {team.invitations.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="px-4 py-3 font-medium text-heading">{i.email}</td>
                    <td className="px-4 py-3">{i.roleName}</td>
                    <td className="px-4 py-3">
                      {i.groupName ?? '—'}
                      <p className="text-xs">
                        {i.memberType === 'external' ? 'External' : 'Internal'}
                      </p>
                    </td>
                    <td className="px-4 py-3">{i.invitedByName}</td>
                    <td className="px-4 py-3">
                      {i.state === 'expired' ? (
                        <Badge tone="warning">Invitation expired</Badge>
                      ) : (
                        <Badge tone="info">Invited</Badge>
                      )}
                      <p className="mt-1 text-xs">
                        {i.state === 'expired' ? 'Expired' : 'Expires'} {fmt.format(i.expiresAt)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {i.manageable ? <InvitationRow id={i.id} email={i.email} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'roles' ? (
        <div className="flex flex-col gap-4">
          <Alert tone="info">
            Roles decide what people can do. Built-in roles cannot be changed; create a custom role
            to mix permissions. You can only give permissions you have yourself.
          </Alert>
          {team.canManageRoles ? (
            <RoleEditor roleId={null} permissions={PERMISSIONS} initial={null} />
          ) : null}
          {team.roles.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl">{r.name}</h2>
                  <p className="text-sm">{r.description}</p>
                </div>
                <div className="flex gap-2">
                  <Badge tone="neutral">{r.isSystem ? 'Built in' : 'Custom'}</Badge>
                  <Badge tone="info">
                    {r.memberCount} {r.memberCount === 1 ? 'member' : 'members'}
                  </Badge>
                </div>
              </div>
              {!r.isSystem && team.canManageRoles ? (
                <RoleEditor
                  roleId={r.id}
                  permissions={PERMISSIONS}
                  initial={{ name: r.name, description: r.description, permissions: r.permissions }}
                />
              ) : (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`${r.name} permissions`}>
                  {r.permissions.length ? (
                    r.permissions.map((p) => (
                      <li
                        key={p}
                        className="rounded-full bg-primary-surface px-2.5 py-0.5 text-xs text-primary"
                      >
                        {PERMISSIONS[p]}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm">No workspace permissions.</li>
                  )}
                </ul>
              )}
            </Card>
          ))}
        </div>
      ) : tab === 'groups' ? (
        <Card>
          <CardHeader
            title="Groups"
            description="Groups organise people, for example Legal or Finance. Being in a group never gives access to documents; access always comes from the role."
          />
          <GroupsPanel groups={team.groups} canManage={team.canManage} />
        </Card>
      ) : members.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="Nobody here yet">
          {tab === 'external'
            ? 'Invite outside collaborators, like an agent or a venue, as External.'
            : 'Invite teammates to work in this workspace.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-white shadow-card">
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">Members</caption>
            <thead className="border-b border-border bg-blush/40 text-xs uppercase tracking-wide text-heading">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Member
                </th>
                <th scope="col" className="px-4 py-3">
                  Role
                </th>
                <th scope="col" className="px-4 py-3">
                  Team
                </th>
                <th scope="col" className="px-4 py-3">
                  Access
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3">
                  Last active
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.membershipId} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-heading">
                      {m.name}
                      {m.isYou ? <span className="font-normal"> (you)</span> : null}
                    </p>
                    <p className="text-xs">{m.email}</p>
                  </td>
                  <td className="px-4 py-3">{m.roleName}</td>
                  <td className="px-4 py-3">{m.groups.map((g) => g.name).join(', ') || '—'}</td>
                  <td className="px-4 py-3">
                    {m.memberType === 'external' ? 'External' : 'Internal'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {m.lastActiveAt ? fmt.format(m.lastActiveAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {m.manageable ? (
                      <MemberControls
                        membershipId={m.membershipId}
                        name={m.name}
                        roleId={m.roleId}
                        status={m.status}
                        memberType={m.memberType}
                        roles={assignable}
                        groups={team.groups.map((g) => ({ id: g.id, name: g.name }))}
                        groupIds={m.groups.map((g) => g.id)}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs">
        People you send documents to are not workspace members and never see this workspace.
      </p>
    </div>
  );
}
