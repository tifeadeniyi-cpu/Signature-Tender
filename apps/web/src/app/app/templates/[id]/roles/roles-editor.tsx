'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { RecipientRole } from '@st/core';
import type { ActionState } from '@/lib/action-result';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { colorFor } from '@/components/documents/colors';
import { saveTemplateRolesAction } from '../../actions';

type Row = {
  id: string;
  label: string;
  role: RecipientRole;
  authMethod: 'email_link' | 'email_code';
};
const uid = () => crypto.randomUUID();

export function RolesEditor({
  templateId,
  disabled,
  maxSigners,
  roles,
  initial,
  initialOrderEnabled,
}: {
  templateId: string;
  disabled: boolean;
  maxSigners: number;
  roles: { value: RecipientRole; label: string; description: string }[];
  initial: Row[];
  initialOrderEnabled: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    initial.length ? initial : [{ id: uid(), label: '', role: 'signer', authMethod: 'email_link' }],
  );
  const [orderEnabled, setOrderEnabled] = useState(initialOrderEnabled);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return rs;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function save(next?: string) {
    const signers = rows.filter((r) => r.role === 'signer').length;
    const labels = rows.map((r) => r.label.trim().toLowerCase());
    if (rows.some((r) => !r.label.trim()))
      return setState({ ok: false, message: 'Name every role, for example "Artist" or "Venue".' });
    if (new Set(labels).size !== labels.length)
      return setState({ ok: false, message: 'Give each role a different name.' });
    if (!signers) return setState({ ok: false, message: 'Add at least one signer role.' });
    if (signers > maxSigners)
      return setState({
        ok: false,
        message: `A signing request includes up to ${maxSigners} signers.`,
      });
    start(async () => {
      const res = await saveTemplateRolesAction(templateId, {
        signingOrderEnabled: orderEnabled,
        recipients: rows.map((r, i) => ({
          id: r.id,
          label: r.label.trim(),
          role: r.role,
          authMethod: r.authMethod,
          signingOrder: orderEnabled ? i + 1 : 1,
        })),
      });
      setState(res);
      if (res?.ok) {
        if (next) router.push(next);
        else router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader
        title="Roles"
        description="Name each person by their part in the agreement. You'll fill in real names and emails each time you use the template."
      />
      <fieldset disabled={disabled || pending} className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm text-heading">
          <input
            type="checkbox"
            checked={orderEnabled}
            onChange={(e) => setOrderEnabled(e.target.checked)}
            className="size-4"
          />
          Sign in order (each role is invited after the one above finishes)
        </label>
        <ol className="flex flex-col gap-3" aria-label="Roles">
          {rows.map((r, i) => (
            <li
              key={r.id}
              className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-3"
            >
              <span
                className="size-3 self-center rounded-full"
                style={{ background: colorFor(i).border }}
                aria-hidden
              />
              {orderEnabled ? (
                <span className="self-center text-sm font-semibold text-heading">{i + 1}.</span>
              ) : null}
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium text-heading">
                Role name
                <input
                  value={r.label}
                  maxLength={60}
                  onChange={(e) => update(r.id, { label: e.target.value })}
                  placeholder="Artist"
                  className="h-10 rounded-lg border border-border px-3 font-normal"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-heading">
                Action
                <select
                  value={r.role}
                  onChange={(e) => update(r.id, { role: e.target.value as RecipientRole })}
                  className="h-10 rounded-lg border border-border px-2 font-normal"
                >
                  {roles.map((x) => (
                    <option key={x.value} value={x.value} title={x.description}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-heading">
                Verification
                <select
                  value={r.authMethod}
                  onChange={(e) =>
                    update(r.id, { authMethod: e.target.value as Row['authMethod'] })
                  }
                  className="h-10 rounded-lg border border-border px-2 font-normal"
                >
                  <option value="email_link">Email link</option>
                  <option value="email_code">Email link and code</option>
                </select>
              </label>
              <span className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${r.label || 'role'} up`}
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${r.label || 'role'} down`}
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${r.label || 'role'}`}
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                  disabled={rows.length === 1}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              { id: uid(), label: '', role: 'signer', authMethod: 'email_link' },
            ])
          }
        >
          <Plus className="size-4" aria-hidden /> Add role
        </Button>
        <p className="text-xs">
          Removing a role or changing it to receive a copy also removes its fields.
        </p>
        <FormStatus state={state} />
        <div className="flex flex-wrap justify-between gap-2">
          <Link href={`/app/templates/${templateId}`} className={buttonClass('ghost')}>
            Back
          </Link>
          {disabled ? (
            <Link href={`/app/templates/${templateId}/fields`} className={buttonClass('primary')}>
              Next: Fields
            </Link>
          ) : (
            <span className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => save()} loading={pending}>
                Save
              </Button>
              <Button
                type="button"
                onClick={() => save(`/app/templates/${templateId}/fields`)}
                disabled={pending}
              >
                Save and continue
              </Button>
            </span>
          )}
        </div>
      </fieldset>
    </Card>
  );
}
