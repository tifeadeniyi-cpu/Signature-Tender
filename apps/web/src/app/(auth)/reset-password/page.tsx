'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

function ResetPassword() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!token)
    return (
      <Alert tone="error">
        This reset link is invalid or has expired.{' '}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </Alert>
    );
  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (fd.get('password') !== fd.get('confirm')) return setError('Passwords do not match.');
        setBusy(true);
        setError('');
        const { error: err } = await authClient.resetPassword({
          token,
          newPassword: String(fd.get('password')),
        });
        setBusy(false);
        if (err) return setError(err.message || 'This reset link is invalid or has expired.');
        router.push('/sign-in?reset=1');
      }}
    >
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
        hint="At least 12 characters"
      />
      <TextField
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" loading={busy}>
        Set new password
      </Button>
    </form>
  );
}

export default function Page() {
  return (
    <>
      <h1 className="font-display text-2xl">Choose a new password</h1>
      <Suspense>
        <ResetPassword />
      </Suspense>
    </>
  );
}
