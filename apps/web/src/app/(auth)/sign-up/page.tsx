'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nextFromLocation } from '@/lib/next-path';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="font-display text-2xl">Create your account</h1>
      <p className="mt-1 text-sm">
        No subscription required. You only pay when you send a document.
      </p>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const email = String(fd.get('email')).trim();
          setBusy(true);
          setError('');
          const { error: err } = await authClient.signUp.email({
            name: String(fd.get('name')).trim(),
            email,
            password: String(fd.get('password')),
            callbackURL: nextFromLocation() ?? '/onboarding',
          });
          setBusy(false);
          if (err) return setError(err.message || 'Could not create your account.');
          const next = nextFromLocation();
          router.push(
            `/verify-email?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ''}`,
          );
        }}
      >
        <TextField label="Full name" name="name" autoComplete="name" required maxLength={120} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          hint="At least 12 characters"
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
