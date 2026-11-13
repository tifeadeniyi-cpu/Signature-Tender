'use client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { ActionState } from '@/lib/action-result';
import {
  automationAction,
  disconnectConnectionAction,
  jobAction,
  saveConnectionSettingsAction,
  testConnectionAction,
} from '../actions';

function Result({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <Alert tone={state.ok ? 'success' : 'error'} className="mt-2">
      {state.message}
    </Alert>
  );
}

export function TestConnectionForm({ id }: { id: string }) {
  const [state, act, pending] = useActionState(testConnectionAction, null);
  return (
    <form action={act}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Test connection
      </Button>
      <Result state={state} />
    </form>
  );
}

/** Two-step: the first click asks to confirm, so a stray click never disconnects. */
export function DisconnectConnectionForm({ id, name }: { id: string; name: string }) {
  const [state, act, pending] = useActionState(disconnectConnectionAction, null);
  const [confirming, setConfirming] = useState(false);
  if (state?.ok) return <Result state={state} />;
  return (
    <form action={act}>
      <input type="hidden" name="id" value={id} />
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Disconnect {name}? Its automations stop.</span>
          <Button type="submit" size="sm" variant="danger" loading={pending}>
            Disconnect
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          Disconnect
        </Button>
      )}
      <Result state={state} />
    </form>
  );
}

export function AutomationButtons({
  id,
  enabled,
  name,
}: {
  id: string;
  enabled: boolean;
  name: string;
}) {
  const [state, act, pending] = useActionState(automationAction, null);
  return (
    <form action={act} className="flex flex-wrap gap-2">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        name="op"
        value={enabled ? 'disable' : 'enable'}
        size="sm"
        variant="secondary"
        loading={pending}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
      >
        {enabled ? 'Disable' : 'Enable'}
      </Button>
      <Button
        type="submit"
        name="op"
        value="duplicate"
        size="sm"
        variant="ghost"
        aria-label={`Duplicate ${name}`}
      >
        Duplicate
      </Button>
      <Button
        type="submit"
        name="op"
        value="delete"
        size="sm"
        variant="ghost"
        aria-label={`Delete ${name}`}
      >
        Delete
      </Button>
      <Result state={state} />
    </form>
  );
}

export function JobButtons({ id, status }: { id: string; status: string }) {
  const [state, act, pending] = useActionState(jobAction, null);
  if (status !== 'failed' && status !== 'pending' && status !== 'retrying') return null;
  return (
    <form action={act}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        name="op"
        value={status === 'failed' ? 'retry' : 'cancel'}
        size="sm"
        variant="secondary"
        loading={pending}
      >
        {status === 'failed' ? 'Retry' : 'Cancel'}
      </Button>
      <Result state={state} />
    </form>
  );
}

export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'checkbox';
  hint?: string;
}

export function ConnectionSettingsForm({
  id,
  fields,
  values,
  canEdit,
}: {
  id: string;
  fields: SettingField[];
  values: Record<string, unknown>;
  canEdit: boolean;
}) {
  const [state, act, pending] = useActionState(saveConnectionSettingsAction, null);
  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input
        type="hidden"
        name="$booleans"
        value={fields
          .filter((f) => f.type === 'checkbox')
          .map((f) => f.key)
          .join(',')}
      />
      <fieldset disabled={!canEdit} className="space-y-3">
        {fields.map((f) =>
          f.type === 'checkbox' ? (
            <label key={f.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name={f.key}
                defaultChecked={values[f.key] === true}
                className="mt-1"
              />
              <span>
                {f.label}
                {f.hint ? <span className="block text-xs">{f.hint}</span> : null}
              </span>
            </label>
          ) : (
            <label key={f.key} className="block text-sm">
              <span className="font-semibold text-heading">{f.label}</span>
              <input
                name={f.key}
                defaultValue={typeof values[f.key] === 'string' ? (values[f.key] as string) : ''}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-white px-3 text-sm"
              />
              {f.hint ? <span className="mt-1 block text-xs">{f.hint}</span> : null}
            </label>
          ),
        )}
      </fieldset>
      {canEdit ? (
        <Button type="submit" size="sm" loading={pending}>
          Save settings
        </Button>
      ) : null}
      <Result state={state} />
    </form>
  );
}
