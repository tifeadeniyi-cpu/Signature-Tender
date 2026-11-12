'use client';
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import {
  startAction,
  verifyCodeAction,
  consentAction,
  declineAction,
  type SignResult,
} from './actions';

function Result({ state }: { state: SignResult }) {
  return state && !state.ok && state.message ? <Alert tone="error">{state.message}</Alert> : null;
}

export function VerifyCard({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (p: SignResult, fd: FormData) => {
    const r = await verifyCodeAction(token, p, fd);
    if (r?.ok) router.refresh();
    return r;
  }, null);
  const [resend, setResend] = useState<SignResult>(null);
  const [resending, start] = useTransition();
  return (
    <form action={action} className="flex flex-col gap-4">
      <h1 className="font-display text-2xl">Check your email</h1>
      <p className="text-sm">We sent a 6-digit code to {email}. It expires in 10 minutes.</p>
      <TextField
        label="Code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        required
      />
      <Result state={state} />
      {resend?.ok ? (
        <Alert tone="success">A new code is on its way.</Alert>
      ) : (
        <Result state={resend} />
      )}
      <Button type="submit" loading={pending}>
        Verify and continue
      </Button>
      <Button
        type="button"
        variant="ghost"
        loading={resending}
        onClick={() => start(async () => setResend(await startAction(token)))}
      >
        Send a new code
      </Button>
    </form>
  );
}

export function ConsentCard({
  token,
  title,
  disclosure,
}: {
  token: string;
  title: string;
  disclosure: { version: string; text: string };
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (p: SignResult, fd: FormData) => {
    const r = await consentAction(token, p, fd);
    if (r?.ok) router.refresh();
    return r;
  }, null);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl">Sign electronically</h1>
      <p className="text-sm">
        Before you open &ldquo;{title}&rdquo;, please read how electronic signing works.
      </p>
      <div
        className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-ivory p-4 text-sm"
        tabIndex={0}
        aria-label="Electronic records and signature disclosure"
      >
        {disclosure.text}
      </div>
      <p className="text-xs">Disclosure version {disclosure.version}</p>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="version" value={disclosure.version} />
        <label className="flex items-start gap-3 text-sm text-heading">
          <input type="checkbox" name="agree" required className="mt-0.5 size-4" />I agree to use
          electronic records and signatures for this document.
        </label>
        <Result state={state} />
        <Button type="submit" loading={pending}>
          Continue
        </Button>
      </form>
      <DeclineForm token={token} />
    </div>
  );
}

export function DeclineForm({ token, compact }: { token: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (p: SignResult, fd: FormData) => {
    const r = await declineAction(token, p, fd);
    if (r?.ok) router.refresh();
    return r;
  }, null);
  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size={compact ? 'sm' : 'md'}
        onClick={() => setOpen(true)}
      >
        Decline to sign
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-heading">
        Reason (optional, shared with the sender)
        <textarea
          name="reason"
          rows={3}
          maxLength={1000}
          className="rounded-lg border border-border px-3 py-2 font-normal"
        />
      </label>
      <Result state={state} />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" size="sm" loading={pending}>
          Decline
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Go back
        </Button>
      </div>
    </form>
  );
}
