'use client';
import { useActionState, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import {
  createKeyAction,
  keyAction,
  createWebhookAction,
  webhookAction,
  retryDeliveryAction,
  type SecretState,
} from './actions';

export function SecretReveal({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning-bg p-3">
      <p className="text-sm font-semibold text-heading">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-heading">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs">Store it somewhere safe. It is shown only once.</p>
    </div>
  );
}

export function Result({ state }: { state: SecretState }) {
  if (!state) return null;
  return (
    <div className="flex flex-col gap-2">
      {state.message ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
      {state.secret ? (
        <SecretReveal
          label={state.secret.startsWith('whsec_') ? 'Webhook signing secret' : 'API key'}
          value={state.secret}
        />
      ) : null}
      {state.secret2 ? <SecretReveal label="Webhook signing secret" value={state.secret2} /> : null}
    </div>
  );
}

export function CreateKeyForm({ scopes }: { scopes: [string, string][] }) {
  const [state, act, pending] = useActionState(createKeyAction, null);
  return (
    <form action={act} className="flex flex-col gap-4">
      <TextField
        label="Key name"
        name="name"
        required
        maxLength={80}
        placeholder="Production server"
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-heading">Scopes</legend>
        {scopes.map(([key, desc]) => (
          <label key={key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="scopes"
              value={key}
              defaultChecked={key.endsWith(':read')}
              className="mt-1"
            />
            <span>
              <code className="font-mono text-xs text-heading">{key}</code> <span>{desc}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="expiresInDays" className="text-sm font-medium text-heading">
          Expires
        </label>
        <select
          id="expiresInDays"
          name="expiresInDays"
          defaultValue="365"
          className="h-10 w-48 rounded-lg border border-border bg-white px-3 text-sm"
        >
          <option value="30">In 30 days</option>
          <option value="90">In 90 days</option>
          <option value="365">In 1 year</option>
          <option value="0">Never</option>
        </select>
      </div>
      <div>
        <Button type="submit" loading={pending}>
          Create key
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function KeyRowActions({ id, name }: { id: string; name: string }) {
  const [state, act, pending] = useActionState(keyAction, null);
  return (
    <form action={act} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          name="intent"
          value="rotate"
          disabled={pending}
          aria-label={`Rotate ${name}`}
        >
          Rotate
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          name="intent"
          value="revoke"
          disabled={pending}
          aria-label={`Revoke ${name}`}
        >
          Revoke
        </Button>
      </div>
      <div className="w-full max-w-md text-left">
        <Result state={state} />
      </div>
    </form>
  );
}

export function CreateWebhookForm({ events }: { events: readonly string[] }) {
  const [state, act, pending] = useActionState(createWebhookAction, null);
  return (
    <form action={act} className="flex flex-col gap-4">
      <TextField
        label="Endpoint URL"
        name="url"
        type="url"
        required
        placeholder="https://example.com/webhooks/signature-tender"
        hint="Public HTTPS addresses only."
      />
      <TextField label="Description" name="description" maxLength={200} placeholder="Optional" />
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-heading">Events</legend>
        <p className="mb-2 text-xs">Leave all unticked to receive every event.</p>
        <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {events.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="events" value={e} className="size-4" />
              <code className="font-mono text-xs">{e}</code>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <Button type="submit" loading={pending}>
          Add endpoint
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function WebhookRowActions({
  id,
  enabled,
  url,
}: {
  id: string;
  enabled: boolean;
  url: string;
}) {
  const [state, act, pending] = useActionState(webhookAction, null);
  return (
    <form action={act} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          name="intent"
          value="test"
          disabled={pending || !enabled}
          aria-label={`Send test event to ${url}`}
        >
          Send test
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          name="intent"
          value={enabled ? 'pause' : 'resume'}
          disabled={pending}
        >
          {enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          name="intent"
          value="rotate"
          disabled={pending}
          aria-label={`Rotate secret for ${url}`}
        >
          Rotate secret
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          name="intent"
          value="delete"
          disabled={pending}
          aria-label={`Delete ${url}`}
        >
          Delete
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function RetryButton({ id }: { id: string }) {
  const [state, act, pending] = useActionState(retryDeliveryAction, null);
  return (
    <form action={act} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Retry
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-xs text-error">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function DeliveryStatus({ status }: { status: string }) {
  const tone =
    status === 'succeeded'
      ? 'success'
      : status === 'dead'
        ? 'error'
        : status === 'failed'
          ? 'warning'
          : 'neutral';
  const label =
    status === 'dead'
      ? 'Failed (no more retries)'
      : status === 'failed'
        ? 'Retrying'
        : status[0]!.toUpperCase() + status.slice(1);
  return <Badge tone={tone}>{label}</Badge>;
}
