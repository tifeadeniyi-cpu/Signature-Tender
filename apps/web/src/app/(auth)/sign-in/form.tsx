'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { isClaimNext, nextFromLocation, safeNextPath } from '@/lib/next-path';
import { track } from '@/components/product/analytics';
import { SocialButtons, type SocialProviderId } from '@/components/auth/social-buttons';

function SignIn({ providers }: { providers: SocialProviderId[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState(
    params.get('error')
      ? params.get('error') === 'account_not_linked'
        ? 'That email already has an account. Sign in with your password, then connect it.'
        : 'Sign-in with that account did not complete. Try again or use your email.'
      : '',
  );
  const [busy, setBusy] = useState(false);
  const claimNext = safeNextPath(params.get('next'));
  const claim = isClaimNext(claimNext)
    ? { existing: params.get('existing') === '1', next: claimNext! }
    : null;
  const signedIn = () => {
    if (isClaimNext(nextFromLocation())) track('existing_user_signed_in');
    router.push(nextFromLocation() ?? '/app');
    router.refresh();
  };
  return (
    <>
      <h1 className="font-display text-2xl">Sign in</h1>
      <p className="mt-1 text-sm">
        {claim
          ? 'Sign in to add your signed document to your account.'
          : claimNext === '/signature-studio/continue'
            ? 'Sign in to save your signature design and unlock it.'
            : 'Welcome back to Signature Tender.'}
      </p>
      {claim?.existing ? (
        <Alert tone="info" className="mt-4">
          You already have a Signature Tender account with the address this document was sent to.
          Sign in and we&apos;ll offer to add the document to it.
        </Alert>
      ) : null}
      {providers.length ? (
        <>
          <div className="mt-6">
            <SocialButtons providers={providers} />
          </div>
          <div className="mt-5 flex items-center gap-3 text-xs" aria-hidden>
            <span className="h-px flex-1 bg-border" /> or sign in with email{' '}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      <form
        className={`${providers.length ? 'mt-5' : 'mt-6'} flex flex-col gap-4`}
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
              return router.push(
                `/verify-email?email=${encodeURIComponent(email)}${nextFromLocation() ? `&next=${encodeURIComponent(nextFromLocation()!)}` : ''}`,
              );
            return setError(
              err.status === 429
                ? 'Too many attempts. Wait a minute and try again.'
                : 'Email or password is incorrect.',
            );
          }
          if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return; // handled by plugin redirect
          signedIn();
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
          signedIn();
        }}
      >
        <Fingerprint className="size-5" aria-hidden /> Sign in with a passkey
      </Button>
      <p className="mt-6 text-center text-sm">
        New to Signature Tender?{' '}
        <Link
          href={claimNext ? `/sign-up?next=${encodeURIComponent(claimNext)}` : '/sign-up'}
          className="font-semibold text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
    </>
  );
}

export function SignInForm({ providers }: { providers: SocialProviderId[] }) {
  return (
    <Suspense>
      <SignIn providers={providers} />
    </Suspense>
  );
}
