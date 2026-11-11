'use client';
import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="font-display text-2xl">Reset your password</h1>
      {sent ? (
        <Alert tone="success" className="mt-4">
          If an account exists for that email, a reset link is on its way. It expires in 1 hour.
        </Alert>
      ) : (
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const { error: err } = await authClient.requestPasswordReset({
              email: String(new FormData(e.currentTarget).get('email')).trim(),
              redirectTo: '/reset-password',
            });
            setBusy(false);
            if (err && err.status === 429)
              return setError('Too many requests. Try again in a few minutes.');
            setSent(true); // Same response whether or not the account exists, to avoid revealing accounts.
          }}
        >
          <TextField label="Email" name="email" type="email" autoComplete="email" required />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/sign-in" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
