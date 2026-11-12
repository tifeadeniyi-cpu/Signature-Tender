'use client';
import { nextFromLocation } from '@/lib/next-path';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

function VerifyEmail() {
  const params = useSearchParams();
  const email = params.get('email') ?? '';
  const failed = params.get('error');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="text-center">
      <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
      <h1 className="mt-3 font-display text-2xl">Check your email</h1>
      {failed ? (
        <Alert tone="error" className="mt-4 text-left">
          That verification link is invalid or has expired. Request a new one below.
        </Alert>
      ) : (
        <p className="mt-2 text-sm">
          We sent a verification link{email ? ` to ${email}` : ''}. Open it to finish creating your
          account. The link expires in 24 hours.
        </p>
      )}
      {email ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-6"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const { error } = await authClient.sendVerificationEmail({
              email,
              callbackURL: nextFromLocation() ?? '/onboarding',
            });
            setBusy(false);
            setMsg(
              error
                ? { tone: 'error', text: error.message || 'Could not resend the email.' }
                : { tone: 'success', text: 'A new verification email is on its way.' },
            );
          }}
        >
          Resend verification email
        </Button>
      ) : null}
      {msg ? (
        <Alert tone={msg.tone} className="mt-4 text-left">
          {msg.text}
        </Alert>
      ) : null}
      <p className="mt-6 text-sm">
        <Link href="/sign-in" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
