'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { connectAction, disconnectAction } from '../settings/developers/actions';
import { Result } from '../settings/developers/panels';

/**
 * Stays mounted after connecting so the one-time secrets remain on screen when the page refreshes
 * into its connected state.
 */
export function ConnectForm({
  provider,
  name,
  connected,
}: {
  provider: string;
  name: string;
  connected: boolean;
}) {
  const [state, act, pending] = useActionState(connectAction, null);
  // Show the secrets only while the connection they belong to is still active.
  const showResult = state ? !state.ok || connected : false;
  if (connected && !showResult) return null;
  return (
    <form action={act} className="flex flex-col gap-3">
      <input type="hidden" name="provider" value={provider} />
      {connected ? null : (
        <>
          <TextField
            label={`${name} webhook URL`}
            name="webhookUrl"
            type="url"
            placeholder="https://…"
            hint={`Optional. Where ${name} receives status updates. You can add it later under Developers.`}
          />
          <div>
            <Button type="submit" size="sm" loading={pending}>
              Connect {name}
            </Button>
          </div>
        </>
      )}
      {showResult ? <Result state={state} /> : null}
    </form>
  );
}

export function DisconnectForm({ provider, name }: { provider: string; name: string }) {
  const [state, act, pending] = useActionState(disconnectAction, null);
  return (
    <form action={act} className="flex flex-col items-end gap-2">
      <input type="hidden" name="provider" value={provider} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`Disconnect ${name}`}
      >
        Disconnect
      </Button>
      <Result state={state} />
    </form>
  );
}
