'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DocumentSettings } from '@st/core';
import type { ActionState } from '@/lib/action-result';
import { Card, CardHeader } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { saveSettingsAction } from '../../../actions';

const METHODS: { value: DocumentSettings['signingMethod']; label: string; hint: string }[] = [
  {
    value: 'electronic_signature',
    label: 'Electronic signature',
    hint: 'Signers draw, type or upload a signature.',
  },
  { value: 'initials_only', label: 'Initials only', hint: 'Signers add their initials.' },
  {
    value: 'acknowledge',
    label: 'Acknowledge',
    hint: 'Signers confirm they have read the document.',
  },
];

export function SettingsForm({
  documentId,
  disabled,
  initial,
  initialMessage,
}: {
  documentId: string;
  disabled: boolean;
  initial: DocumentSettings;
  initialMessage: string;
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [message, setMessage] = useState(initialMessage);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof DocumentSettings>(k: K, v: DocumentSettings[K]) =>
    setS((p) => ({ ...p, [k]: v }));
  const today = new Date().toISOString().slice(0, 10);

  function save(next?: string) {
    start(async () => {
      const res = await saveSettingsAction(documentId, { settings: s, emailMessage: message });
      setState(res);
      if (res?.ok) {
        if (next) router.push(next);
        else router.refresh();
      }
    });
  }

  return (
    <fieldset disabled={disabled || pending} className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Signing method" />
        <div role="radiogroup" aria-label="Signing method" className="flex flex-col gap-2">
          {METHODS.map((m) => (
            <label
              key={m.value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-surface"
            >
              <input
                type="radio"
                name="signingMethod"
                className="mt-1 size-4"
                checked={s.signingMethod === m.value}
                onChange={() => set('signingMethod', m.value)}
              />
              <span>
                <span className="block text-sm font-semibold text-heading">{m.label}</span>
                <span className="block text-xs">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <h3 className="mt-6 text-sm font-semibold text-heading">Signer access</h3>
        <div className="mt-2 flex flex-col gap-2">
          <Toggle
            label="Allow signers to download the document"
            checked={s.allowDownload}
            onChange={(v) => set('allowDownload', v)}
          />
          <Toggle
            label="Allow signers to print the document"
            checked={s.allowPrint}
            onChange={(v) => set('allowPrint', v)}
          />
          <Toggle
            label="Require an emailed code before signing"
            checked={s.requireSignerAuth}
            onChange={(v) => set('requireSignerAuth', v)}
          />
          <Toggle
            label="Show the signing date on the document"
            checked={s.showSigningDate}
            onChange={(v) => set('showSigningDate', v)}
          />
        </div>
      </Card>
      <Card>
        <CardHeader title="Delivery" />
        <div className="flex flex-col gap-4">
          <Toggle
            label="Send reminders to people who have not signed"
            checked={s.reminderEnabled}
            onChange={(v) => set('reminderEnabled', v)}
          />
          {s.reminderEnabled ? (
            <label className="flex flex-col gap-1 text-sm font-medium text-heading">
              Remind every
              <span className="flex items-center gap-2 font-normal">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={s.reminderEveryDays}
                  onChange={(e) =>
                    set('reminderEveryDays', Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                  }
                  className="h-10 w-20 rounded-lg border border-border px-2"
                />
                days
              </span>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm font-medium text-heading">
            Expiration date (optional)
            <input
              type="date"
              min={today}
              value={s.expiresAt ?? ''}
              onChange={(e) => set('expiresAt', e.target.value || null)}
              className="h-10 w-48 rounded-lg border border-border px-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-heading">
            Message to recipients (optional)
            <textarea
              rows={4}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Please review and sign at your convenience."
              className="rounded-lg border border-border px-3 py-2 font-normal"
            />
            <span className="text-xs font-normal">{message.length} / 2000</span>
          </label>
        </div>
      </Card>
      <div className="flex flex-col gap-3 lg:col-span-2">
        <FormStatus state={state} />
        <div className="flex flex-wrap justify-between gap-2">
          <Link
            href={`/app/documents/${documentId}/prepare/fields`}
            className={buttonClass('ghost')}
          >
            Back
          </Link>
          {disabled ? (
            <Link
              href={`/app/documents/${documentId}/prepare/review`}
              className={buttonClass('primary')}
            >
              Next: Review
            </Link>
          ) : (
            <span className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => save()} loading={pending}>
                Save
              </Button>
              <Button
                type="button"
                onClick={() => save(`/app/documents/${documentId}/prepare/review`)}
                disabled={pending}
              >
                Save and continue
              </Button>
            </span>
          )}
        </div>
      </div>
    </fieldset>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg px-1 py-1 text-sm text-heading">
      {label}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 shrink-0"
      />
    </label>
  );
}
