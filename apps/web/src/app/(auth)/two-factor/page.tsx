'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

export default function TwoFactorPage() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1 className="font-display text-2xl">Two-step verification</h1>
      <p className="mt-1 text-sm">
        {useBackup
          ? 'Enter one of your backup codes.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const code = String(fd.get('code')).replace(/\s/g, '');
          const trustDevice = fd.get('trust') === 'on';
          setBusy(true);
          setError('');
          const { error: err } = useBackup
            ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
            : await authClient.twoFactor.verifyTotp({ code, trustDevice });
          setBusy(false);
          if (err)
            return setError(
              err.status === 429 ? 'Too many attempts. Wait a minute.' : 'That code is not valid.',
            );
          router.push('/app');
          router.refresh();
        }}
      >
        <TextField
          key={String(useBackup)}
          label={useBackup ? 'Backup code' : 'Authentication code'}
          name="code"
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          required
          autoFocus
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="trust" className="size-4 accent-primary" /> Trust this device
          for 30 days
        </label>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" size="lg" loading={busy}>
          Verify
        </Button>
      </form>
      <button
        type="button"
        className="mt-4 w-full text-center text-sm text-primary hover:underline"
        onClick={() => setUseBackup((v) => !v)}
      >
        {useBackup ? 'Use authenticator app instead' : 'Use a backup code'}
      </button>
    </>
  );
}
