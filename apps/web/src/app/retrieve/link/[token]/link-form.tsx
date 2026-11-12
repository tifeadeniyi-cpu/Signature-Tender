'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { linkAction } from './actions';
import type { LinkTarget } from '@/lib/notifications';

const input = 'h-11 rounded-lg border border-border bg-white px-3 text-base font-normal';

export function LinkVerifyForm({
  token,
  to,
  maskedEmail,
  expired,
}: {
  token: string;
  to: LinkTarget;
  maskedEmail: string;
  expired: boolean;
}) {
  const [state, act, pending] = useActionState(linkAction.bind(null, token, to), null);

  if (state?.step === 'renewed')
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{state.message}</Alert>
        <Link href={state.destination} className={buttonClass('primary')}>
          Continue to the document
        </Link>
      </div>
    );

  if (state?.step === 'code')
    return (
      <div className="flex flex-col gap-4">
        {state.message ? (
          <Alert tone={state.error ? 'error' : 'info'}>{state.message}</Alert>
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
            {expired ? 'Verify and request a new secure link' : 'Verify and open the document'}
          </Button>
        </form>
        <form action={act}>
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            Send a new code
          </Button>
        </form>
      </div>
    );

  return (
    <form action={act} className="flex flex-col gap-3">
      {state?.message ? <Alert tone={state.error ? 'error' : 'info'}>{state.message}</Alert> : null}
      <p className="text-sm">
        For your security, we will email a one-time code to{' '}
        <strong className="text-heading">{maskedEmail}</strong>, the address this document was sent
        to.
      </p>
      <Button type="submit" loading={pending}>
        {expired ? 'Request a new secure link' : 'Email me a code'}
      </Button>
    </form>
  );
}
