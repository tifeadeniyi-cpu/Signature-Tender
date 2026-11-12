'use client';
import { useActionState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { verifyRecipientAction } from './actions';

const input =
  'h-12 rounded-lg border border-border bg-white px-3 text-lg font-normal tracking-[0.4em]';

/** Secure re-verification when a recipient returns after their signing session has ended. */
export function RecipientVerifyForm({
  token,
  title,
  maskedEmail,
}: {
  token: string;
  title: string;
  maskedEmail: string;
}) {
  const [state, act, pending] = useActionState(verifyRecipientAction.bind(null, token), null);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-7 text-primary" aria-hidden />
        <h1 className="font-display text-3xl">Confirm it&apos;s you</h1>
      </div>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-6 shadow-card">
        <p className="font-display text-xl text-heading">{title}</p>
        {state?.message ? (
          <Alert tone={state.error ? 'error' : 'info'}>{state.message}</Alert>
        ) : null}
        {state?.step === 'code' ? (
          <>
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
                  className={input}
                />
              </label>
              <Button type="submit" size="lg" loading={pending}>
                Verify and open the document
              </Button>
            </form>
            <form action={act}>
              <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                Send a new code
              </Button>
            </form>
          </>
        ) : (
          <form action={act} className="flex flex-col gap-3">
            <p className="text-sm">
              Your secure signing session has ended. To open this document again, we&apos;ll email a
              one-time code to <strong className="text-heading">{maskedEmail}</strong>, the address
              it was sent to. You don&apos;t need an account.
            </p>
            <Button type="submit" size="lg" loading={pending}>
              Email me a code
            </Button>
          </form>
        )}
      </div>
      <p className="text-xs">
        Forwarding the link does not give anyone else access: the code only goes to the original
        address.
      </p>
    </div>
  );
}
