'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nextFromLocation } from '@/lib/next-path';
import { track } from '@/components/product/analytics';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

export function SignUpForm({
  defaultEmail,
  claim,
  studio = false,
}: {
  defaultEmail?: string | null;
  /** Arrived from a completed document's Create Free Account. */
  claim: boolean;
  /** Arrived from Signature Studio's "Create Free Account". */
  studio?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="font-display text-2xl">
        {claim || studio ? 'Create your free account' : 'Create your account'}
      </h1>
      <p className="mt-1 text-sm">
        {studio
          ? 'Save your signature design and unlock it. Your design comes with you to your new account.'
          : claim
            ? 'Keep your signed document in one place. No subscription required: you only pay if you send documents yourself.'
            : 'No subscription required. You only pay when you send a document.'}
      </p>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const email = String(fd.get('email')).trim();
          setBusy(true);
          setError('');
          if (claim) track('registration_started');
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
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={defaultEmail ?? undefined}
          hint={
            claim && defaultEmail
              ? 'The address your document was sent to. Use it so we can add the document to your account.'
              : undefined
          }
        />
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
        <Link
          href={(() => {
            const next = nextFromLocation();
            return next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in';
          })()}
          className="font-semibold text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
