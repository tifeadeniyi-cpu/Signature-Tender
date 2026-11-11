'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="font-display text-2xl">Sign in</h1>
      <p className="mt-1 text-sm">Welcome back to Signature Tender.</p>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const email = String(fd.get('email')).trim();
          setBusy(true);
          setError('');
          const { data, error: err } = await authClient.signIn.email({
            email,
            password: String(fd.get('password')),
          });
          setBusy(false);
          if (err) {
            if (err.status === 403)
              return router.push(`/verify-email?email=${encodeURIComponent(email)}`);
            return setError(
              err.status === 429
                ? 'Too many attempts. Wait a minute and try again.'
                : 'Email or password is incorrect.',
            );
          }
          if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return; // handled by plugin redirect
          router.push('/app');
          router.refresh();
        }}
      >
        <TextField label="Email" name="email" type="email" autoComplete="email webauthn" required />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password webauthn"
          required
        />
        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" loading={busy}>
          Sign in
        </Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs" aria-hidden>
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={async () => {
          setError('');
          const res = await authClient.signIn.passkey();
          if (res?.error) return setError(res.error.message || 'Passkey sign-in did not complete.');
          router.push('/app');
          router.refresh();
        }}
      >
        <Fingerprint className="size-5" aria-hidden /> Sign in with a passkey
      </Button>
      <p className="mt-6 text-center text-sm">
        New to Signature Tender?{' '}
        <Link href="/sign-up" className="font-semibold text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
