'use client';
import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2, UserRound } from 'lucide-react';
import type { RecipientRole } from '@st/core';
import type { ActionState } from '@/lib/action-result';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormStatus } from '@/components/ui/form-status';
import { colorFor } from '@/components/documents/colors';
import { saveRecipientsAction } from '../../../actions';
import Link from 'next/link';

type Row = {
  key: string;
  id?: string;
  name: string;
  email: string;
  role: RecipientRole;
  signingOrder: number;
  authMethod: 'email_link' | 'email_code';
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let counter = 0;
const newKey = () => `new-${++counter}`;

export function SignersEditor({
  documentId,
  disabled,
  maxSigners,
  roles,
  initial,
  initialOrderEnabled,
  fieldCounts,
}: {
  documentId: string;
  disabled: boolean;
  maxSigners: number;
  roles: { value: RecipientRole; label: string; description: string; canHaveFields: boolean }[];
  initial: Omit<Row, 'key'>[];
  initialOrderEnabled: boolean;
  fieldCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    initial.length
      ? initial.map((r) => ({ ...r, key: r.id ?? newKey() }))
      : [
          {
            key: newKey(),
            name: '',
            email: '',
            role: 'signer',
            signingOrder: 1,
            authMethod: 'email_link',
          },
        ],
  );
  const [orderEnabled, setOrderEnabled] = useState(initialOrderEnabled);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();

  const signerCount = rows.filter((r) => r.role === 'signer').length;
  const emails = rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean);
  const dupes = new Set(emails.filter((e, i) => emails.indexOf(e) !== i));

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs];
      const j = i + dir;
      if (j < 0 || j >= next.length) return rs;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  function problems(): string | null {
    if (signerCount === 0) return 'Add at least one signer.';
    if (signerCount > maxSigners) return `A signing request includes up to ${maxSigners} signers.`;
    for (const r of rows) {
      if (!r.name.trim()) return 'Every recipient needs a name.';
      if (!EMAIL_RE.test(r.email.trim()))
        return `Enter a valid email for ${r.name || 'each recipient'}.`;
    }
    if (dupes.size) return 'Each person can appear once. Remove the duplicate email.';
    return null;
  }

  function save(next?: string) {
    const p = problems();
    if (p) return setState({ ok: false, message: p });
    start(async () => {
      const res = await saveRecipientsAction(documentId, {
        signingOrderEnabled: orderEnabled,
        recipients: rows.map((r, i) => ({
          id: r.id,
          name: r.name.trim(),
          email: r.email.trim(),
          role: r.role,
          signingOrder: orderEnabled ? i + 1 : 1,
          authMethod: r.authMethod,
        })),
      });
      setState(res);
      if (res?.ok) {
        if (next) router.push(next);
        else router.refresh();
      }
    });
  }

  const losingFields = rows.filter(
    (r) =>
      r.id && (fieldCounts[r.id] ?? 0) > 0 && !roles.find((x) => x.value === r.role)?.canHaveFields,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader
          title="Who needs to sign?"
          description={`Up to ${maxSigners} signers per request. Reviewers and people who receive a copy do not count toward that limit.`}
        />
        <fieldset disabled={disabled || pending} className="flex flex-col gap-4">
          <label className="flex items-center gap-3 text-sm text-heading">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-primary)]"
              checked={orderEnabled}
              onChange={(e) => setOrderEnabled(e.target.checked)}
            />
            Set signing order (people sign one after another, in the order listed)
          </label>
          <ol className="flex flex-col gap-3">
            {rows.map((r, i) => {
              const c = colorFor(i);
              const dup = dupes.has(r.email.trim().toLowerCase());
              return (
                <li
                  key={r.key}
                  className="rounded-xl border border-border p-4"
                  style={{ borderLeft: `4px solid ${c.border}` }}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span
                      className="flex items-center gap-2 text-sm font-semibold"
                      style={{ color: c.text }}
                    >
                      <UserRound className="size-4" aria-hidden />
                      {orderEnabled ? `${i + 1}. ` : ''}
                      {r.name || `Recipient ${i + 1}`}
                    </span>
                    <span className="flex gap-1">
                      {orderEnabled ? (
                        <>
                          <button
                            type="button"
                            className="rounded p-1.5 hover:bg-blush disabled:opacity-30"
                            onClick={() => move(i, -1)}
                            disabled={i === 0}
                            aria-label={`Move ${r.name || 'recipient'} up`}
                          >
                            <ArrowUp className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1.5 hover:bg-blush disabled:opacity-30"
                            onClick={() => move(i, 1)}
                            disabled={i === rows.length - 1}
                            aria-label={`Move ${r.name || 'recipient'} down`}
                          >
                            <ArrowDown className="size-4" aria-hidden />
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="rounded p-1.5 text-error hover:bg-error-bg disabled:opacity-30"
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        disabled={rows.length === 1}
                        aria-label={`Remove ${r.name || 'recipient'}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_160px_170px]">
                    <Input
                      label="Full name"
                      value={r.name}
                      onChange={(v) => update(r.key, { name: v })}
                      autoComplete="off"
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={r.email}
                      onChange={(v) => update(r.key, { email: v })}
                      error={dup ? 'Already listed' : undefined}
                      autoComplete="off"
                    />
                    <Select
                      label="Role"
                      value={r.role}
                      onChange={(v) => update(r.key, { role: v as RecipientRole })}
                    >
                      {roles.map((x) => (
                        <option key={x.value} value={x.value}>
                          {x.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label="Verification"
                      value={r.authMethod}
                      onChange={(v) => update(r.key, { authMethod: v as Row['authMethod'] })}
                    >
                      <option value="email_link">Email link</option>
                      <option value="email_code">Email link + code</option>
                    </Select>
                  </div>
                </li>
              );
            })}
          </ol>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  {
                    key: newKey(),
                    name: '',
                    email: '',
                    role: 'signer',
                    signingOrder: rs.length + 1,
                    authMethod: 'email_link',
                  },
                ])
              }
              disabled={rows.length >= 50}
            >
              <Plus className="size-4" aria-hidden /> Add recipient
            </Button>
          </div>
        </fieldset>
        {losingFields.length ? (
          <Alert tone="warning" className="mt-4">
            Fields placed for {losingFields.map((r) => r.name).join(', ')} will be removed when you
            save, because their new role does not sign.
          </Alert>
        ) : null}
        <div className="mt-4 flex flex-col gap-3">
          <FormStatus state={state} />
          <div className="flex flex-wrap justify-between gap-2">
            <Link
              href={`/app/documents/${documentId}/prepare/document`}
              className={buttonClass('ghost')}
            >
              Back
            </Link>
            {disabled ? (
              <Link
                href={`/app/documents/${documentId}/prepare/fields`}
                className={buttonClass('primary')}
              >
                Next: Fields
              </Link>
            ) : (
              <span className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => save()} loading={pending}>
                  Save
                </Button>
                <Button
                  type="button"
                  onClick={() => save(`/app/documents/${documentId}/prepare/fields`)}
                  disabled={pending}
                >
                  Save and continue
                </Button>
              </span>
            )}
          </div>
        </div>
      </Card>
      <Card className="h-fit">
        <h2 className="font-display text-lg">Roles</h2>
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {roles.map((x) => (
            <li key={x.value}>
              <p className="font-semibold text-heading">{x.label}</p>
              <p>{x.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-border pt-4 text-sm">
          Signers in this request: <strong className="text-heading">{signerCount}</strong> of{' '}
          {maxSigners}
        </p>
      </Card>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  type?: string;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-heading">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className={`h-10 rounded-lg border bg-white px-3 text-sm focus:border-primary-hover focus:outline-none focus:ring-2 focus:ring-primary-surface ${error ? 'border-error' : 'border-border'}`}
      />
      {error ? (
        <span id={`${id}-err`} className="text-xs text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-heading">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-lg border border-border bg-white px-2 font-normal focus:border-primary-hover focus:outline-none focus:ring-2 focus:ring-primary-surface"
      >
        {children}
      </select>
    </label>
  );
}
