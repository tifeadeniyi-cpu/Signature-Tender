'use client';
import { useActionState, useState } from 'react';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormStatus } from '@/components/ui/form-status';
import type { ActionState } from '@/lib/action-result';
import {
  groupAction,
  inviteAction,
  memberAction,
  resendInviteAction,
  revokeInviteAction,
  roleAction,
} from './actions';

type Opt = { id: string; name: string };
const input = 'h-10 rounded-lg border border-border bg-white px-3 text-sm';
const label = 'flex flex-col gap-1 text-sm font-medium text-heading';

export function InviteForm({ roles, groups }: { roles: Opt[]; groups: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(inviteAction, null);
  if (!open)
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" aria-hidden /> Invite Member
      </Button>
    );
  return (
    <form
      action={act}
      aria-label="Invite a member"
      className="flex w-full flex-col gap-3 rounded-2xl border border-border bg-white p-4 shadow-card sm:w-[28rem]"
    >
      <label className={label}>
        Email
        <input name="email" type="email" required className={input} autoComplete="off" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Role
          <select
            name="roleId"
            required
            className={input}
            defaultValue={roles.find((r) => r.name === 'Editor')?.id}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Team
          <select name="groupId" className={input} defaultValue="">
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Access
          <select name="memberType" className={input} defaultValue="internal">
            <option value="internal">Internal team</option>
            <option value="external">External collaborator</option>
          </select>
        </label>
        <label className={label}>
          Expires after
          <select name="expiresInDays" className={input} defaultValue="7">
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? 'day' : 'days'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs">
        They can accept only with this email address. Their role decides what they can see.
      </p>
      <FormStatus state={state} />
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Send invitation
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function InvitationRow({ id, email }: { id: string; email: string }) {
  const [rs, resend, resending] = useActionState(resendInviteAction.bind(null, id), null);
  const [vs, revoke, revoking] = useActionState(revokeInviteAction.bind(null, id), null);
  const state = vs ?? rs;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <form action={resend}>
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            loading={resending}
            aria-label={`Resend invitation to ${email}`}
          >
            Resend
          </Button>
        </form>
        <form action={revoke}>
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            loading={revoking}
            aria-label={`Cancel invitation to ${email}`}
          >
            Cancel
          </Button>
        </form>
      </div>
      {state?.message ? (
        <span
          role={state.ok ? 'status' : 'alert'}
          className={`text-xs ${state.ok ? 'text-success' : 'text-error'}`}
        >
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

export function MemberControls(props: {
  membershipId: string;
  name: string;
  roleId: string;
  status: string;
  memberType: 'internal' | 'external';
  roles: Opt[];
  groups: Opt[];
  groupIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(
    memberAction.bind(null, props.membershipId),
    null as ActionState,
  );
  const [confirm, setConfirm] = useState(false);
  if (!open)
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`Manage ${props.name}`}
      >
        Manage
      </Button>
    );
  return (
    <div className="flex w-64 flex-col gap-3 rounded-xl border border-border p-3">
      <form action={act} className="flex items-end gap-2">
        <input type="hidden" name="intent" value="role" />
        <label className={`${label} flex-1`}>
          Role
          <select name="roleId" defaultValue={props.roleId} className={input}>
            {props.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </form>
      <form action={act} className="flex items-end gap-2">
        <input type="hidden" name="intent" value="type" />
        <label className={`${label} flex-1`}>
          Access
          <select name="memberType" defaultValue={props.memberType} className={input}>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </form>
      {props.groups.length ? (
        <form action={act} className="flex flex-col gap-1">
          <input type="hidden" name="intent" value="groups" />
          <fieldset>
            <legend className="text-sm font-medium text-heading">Groups</legend>
            {props.groups.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="groupId"
                  value={g.id}
                  defaultChecked={props.groupIds.includes(g.id)}
                />
                {g.name}
              </label>
            ))}
          </fieldset>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            Save groups
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-1 border-t border-border pt-2">
        <form action={act}>
          <input
            type="hidden"
            name="intent"
            value={props.status === 'suspended' ? 'activate' : 'suspend'}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {props.status === 'suspended' ? 'Reactivate' : 'Suspend'}
          </Button>
        </form>
        {confirm ? (
          <form action={act} className="flex gap-1">
            <input type="hidden" name="intent" value="remove" />
            <Button type="submit" size="sm" variant="danger" disabled={pending}>
              Yes, remove
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-error"
            onClick={() => setConfirm(true)}
          >
            Remove
          </Button>
        )}
      </div>
      <p className="text-xs">Removing someone keeps the documents they sent and their history.</p>
      <FormStatus state={state} />
    </div>
  );
}

export function RoleEditor({
  roleId,
  permissions,
  initial,
}: {
  roleId: string | null;
  permissions: Record<string, string>;
  initial: { name: string; description: string; permissions: string[] } | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState(roleAction.bind(null, roleId), null);
  if (!open)
    return (
      <div className={roleId ? 'mt-3' : ''}>
        <Button
          type="button"
          variant={roleId ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => setOpen(true)}
        >
          {roleId ? (
            'Edit role'
          ) : (
            <>
              <Plus className="size-4" aria-hidden /> Create custom role
            </>
          )}
        </Button>
      </div>
    );
  return (
    <form
      action={act}
      aria-label={roleId ? `Edit ${initial?.name}` : 'Create custom role'}
      className="mt-3 flex flex-col gap-3 rounded-2xl border border-border bg-white p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Role name
          <input
            name="name"
            required
            maxLength={60}
            defaultValue={initial?.name}
            className={input}
          />
        </label>
        <label className={label}>
          Description
          <input
            name="description"
            maxLength={200}
            defaultValue={initial?.description}
            className={input}
          />
        </label>
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-heading">Permissions</legend>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {Object.entries(permissions).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="permission"
                value={k}
                defaultChecked={initial?.permissions.includes(k)}
              />
              {v}
            </label>
          ))}
        </div>
      </fieldset>
      <FormStatus state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending} name="intent" value="save">
          {roleId ? 'Save role' : 'Create role'}
        </Button>
        {roleId ? (
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            className="text-error"
            name="intent"
            value="delete"
            disabled={pending}
          >
            <Trash2 className="size-4" aria-hidden /> Delete role
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function GroupsPanel({
  groups,
  canManage,
}: {
  groups: { id: string; name: string; memberCount: number }[];
  canManage: boolean;
}) {
  const [state, act, pending] = useActionState(groupAction, null);
  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <p className="text-sm">No groups yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Groups">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="font-medium text-heading">{g.name}</span>
              <span className="flex items-center gap-2">
                {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                {canManage ? (
                  <form action={act}>
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="groupId" value={g.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete group ${g.name}`}
                      disabled={pending}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </form>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form action={act} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="create" />
          <label className={label}>
            New group
            <input name="name" required maxLength={60} placeholder="Legal" className={input} />
          </label>
          <Button type="submit" loading={pending}>
            Add group
          </Button>
        </form>
      ) : null}
      {state && !state.ok ? <Alert tone="error">{state.message}</Alert> : null}
    </div>
  );
}
