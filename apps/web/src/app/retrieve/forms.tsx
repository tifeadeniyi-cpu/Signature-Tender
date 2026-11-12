'use client';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { endRetrievalAction, newLinkAction, retrieveAction } from './actions';

const input = 'h-11 rounded-lg border border-border bg-white px-3 text-base font-normal';

export function RetrieveForms() {
  const [state, act, pending] = useActionState(retrieveAction, null);
  const current = state;

  if (current?.step === 'code') {
    return (
      <div className="flex flex-col gap-4">
        {current.message ? (
          <Alert tone={current.error ? 'error' : 'info'}>{current.message}</Alert>
        ) : null}
        <form action={act} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="verify" />
          <label className="flex flex-col gap-1 text-sm font-medium text-heading">
            6-digit code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              className={`${input} tracking-[0.4em]`}
            />
          </label>
          <Button type="submit" loading={pending}>
            Verify and show my documents
          </Button>
        </form>
        <form action={act}>
          <input type="hidden" name="email" value={current.email} />
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            Send a new code
          </Button>
        </form>
      </div>
    );
  }
  return (
    <form action={act} className="flex flex-col gap-3">
      {state?.message ? <Alert tone={state.error ? 'error' : 'info'}>{state.message}</Alert> : null}
      <label className="flex flex-col gap-1 text-sm font-medium text-heading">
        Email address the documents were sent to
        <input name="email" type="email" autoComplete="email" required className={input} />
      </label>
      <Button type="submit" loading={pending}>
        Email me a code
      </Button>
    </form>
  );
}

export function NewLinkButton({ requestId }: { requestId: string }) {
  const [state, run, pending] = useActionState(newLinkAction.bind(null, requestId), null);
  return (
    <form action={run} className="flex flex-col gap-2">
      <Button type="submit" size="sm" loading={pending}>
        Email me a new signing link
      </Button>
      {state ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
    </form>
  );
}

export function EndSessionButton() {
  return (
    <form action={endRetrievalAction}>
      <Button type="submit" variant="secondary" size="sm">
        Done, sign out
      </Button>
    </form>
  );
}
