'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { KeyRound, Smartphone, MonitorSmartphone, Fingerprint, Trash2 } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { Card, CardHeader } from '@/components/ui/card';
import { TextField } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Alert, Badge } from '@/components/ui/feedback';

type Msg = { tone: 'success' | 'error'; text: string } | null;

function errText(e: { message?: string | undefined } | null | undefined, fallback: string) {
  return e?.message || fallback;
}

function PasswordPanel() {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Password"
        description="Changing your password signs you out on other devices."
      />
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const form = e.currentTarget;
          setBusy(true);
          setMsg(null);
          const { error } = await authClient.changePassword({
            currentPassword: String(fd.get('current')),
            newPassword: String(fd.get('next')),
            revokeOtherSessions: true,
          });
          setBusy(false);
          if (error) setMsg({ tone: 'error', text: errText(error, 'Could not change password.') });
          else {
            form.reset();
            setMsg({ tone: 'success', text: 'Password changed. Other devices were signed out.' });
          }
        }}
      >
        <TextField
          label="Current password"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
        <TextField
          label="New password"
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          hint="At least 12 characters"
        />
        <div className="flex items-center justify-between gap-4 sm:col-span-2">
          <div className="flex-1">{msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}</div>
          <Button type="submit" loading={busy}>
            <KeyRound className="size-4" aria-hidden /> Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<'idle' | 'verify' | 'codes'>('idle');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function start(password: string) {
    setBusy(true);
    setMsg(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (error || !data || data.method !== 'totp')
      return setMsg({ tone: 'error', text: errText(error, 'Could not start setup.') });
    setQr(
      await QRCode.toDataURL(data.totpURI, {
        margin: 1,
        width: 192,
        color: { dark: '#0d1b33', light: '#FFFFFF' },
      }),
    );
    setSecret(new URL(data.totpURI).searchParams.get('secret') ?? '');
    setCodes(data.backupCodes);
    setStage('verify');
  }

  async function verify(code: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (error)
      return setMsg({
        tone: 'error',
        text: errText(error, 'That code did not match. Try the newest code.'),
      });
    setStage('codes');
  }

  async function disable(password: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (error)
      return setMsg({
        tone: 'error',
        text: errText(error, 'Could not turn off two-step verification.'),
      });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Two-step verification"
        description="Require a code from an authenticator app when you sign in."
        action={enabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>}
      />
      {stage === 'idle' ? (
        <form
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const pw = String(new FormData(e.currentTarget).get('password'));
            void (enabled ? disable(pw) : start(pw));
          }}
        >
          <TextField
            className="flex-1"
            label="Confirm your password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Button type="submit" variant={enabled ? 'secondary' : 'primary'} loading={busy}>
            <Smartphone className="size-4" aria-hidden />{' '}
            {enabled ? 'Turn off' : 'Set up authenticator'}
          </Button>
        </form>
      ) : null}
      {stage === 'verify' ? (
        <div className="grid gap-6 sm:grid-cols-[192px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt="QR code for your authenticator app"
            width={192}
            height={192}
            className="rounded-lg border border-border"
          />
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void verify(String(new FormData(e.currentTarget).get('code')).replace(/\s/g, ''));
            }}
          >
            <p className="text-sm">
              Scan the QR code with an authenticator app, or enter this key manually:
            </p>
            <code className="break-all rounded-lg bg-blush px-3 py-2 text-sm text-heading">
              {secret}
            </code>
            <TextField
              label="6-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              required
            />
            <Button type="submit" loading={busy} className="self-start">
              Verify and turn on
            </Button>
          </form>
        </div>
      ) : null}
      {stage === 'codes' ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">Two-step verification is on.</Alert>
          <p className="text-sm">
            Save these backup codes somewhere safe. Each one works once if you lose your device.
            They will not be shown again.
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-lg bg-blush p-3 font-mono text-sm text-heading sm:grid-cols-5">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button type="button" className="self-start" onClick={() => router.refresh()}>
            I saved my codes
          </Button>
        </div>
      ) : null}
      {msg ? (
        <Alert className="mt-4" tone={msg.tone}>
          {msg.text}
        </Alert>
      ) : null}
    </Card>
  );
}

type PasskeyRow = { id: string; name?: string | null; createdAt?: string | Date | null };

function PasskeyPanel() {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    authClient.passkey.listUserPasskeys().then(({ data, error }) => {
      if (!live) return;
      if (error) setMsg({ tone: 'error', text: errText(error, 'Could not load passkeys.') });
      setRows((data as PasskeyRow[] | null) ?? []);
    });
    return () => {
      live = false;
    };
  }, [version]);
  return (
    <Card>
      <CardHeader
        title="Passkeys"
        description="Sign in with your device's fingerprint, face or screen lock instead of a password."
        action={
          <Button
            type="button"
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              const res = await authClient.passkey.addPasskey({
                name: navigator.platform || 'Passkey',
              });
              setBusy(false);
              if (res?.error)
                setMsg({ tone: 'error', text: errText(res.error, 'Passkey was not added.') });
              else {
                setMsg({ tone: 'success', text: 'Passkey added.' });
                load();
              }
            }}
          >
            <Fingerprint className="size-4" aria-hidden /> Add passkey
          </Button>
        }
      />
      {rows === null ? (
        <p className="text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm">No passkeys yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-heading">{p.name || 'Passkey'}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Remove passkey ${p.name || ''}`}
                onClick={async () => {
                  if (!window.confirm('Remove this passkey?')) return;
                  const { error } = await authClient.passkey.deletePasskey({ id: p.id });
                  if (error)
                    setMsg({ tone: 'error', text: errText(error, 'Could not remove passkey.') });
                  load();
                }}
              >
                <Trash2 className="size-4" aria-hidden /> Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {msg ? (
        <Alert className="mt-4" tone={msg.tone}>
          {msg.text}
        </Alert>
      ) : null}
    </Card>
  );
}

type SessionRow = {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string | Date;
};

function SessionsPanel() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [current, setCurrent] = useState<string>('');
  const [msg, setMsg] = useState<Msg>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    Promise.all([authClient.listSessions(), authClient.getSession()]).then(([list, me]) => {
      if (!live) return;
      if (list.error)
        setMsg({ tone: 'error', text: errText(list.error, 'Could not load sessions.') });
      setRows((list.data as SessionRow[] | null) ?? []);
      setCurrent(me.data?.session.token ?? '');
    });
    return () => {
      live = false;
    };
  }, [version]);
  return (
    <Card>
      <CardHeader
        title="Active sessions"
        description="Devices currently signed in to your account."
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              const { error } = await authClient.revokeOtherSessions();
              setMsg(
                error
                  ? { tone: 'error', text: errText(error, 'Could not sign out other sessions.') }
                  : { tone: 'success', text: 'Signed out of all other sessions.' },
              );
              load();
            }}
          >
            Sign out other sessions
          </Button>
        }
      />
      {rows === null ? (
        <p className="text-sm">Loading…</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <MonitorSmartphone className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-heading">
                    {s.userAgent ?? 'Unknown device'}
                  </span>
                  <span className="block text-xs">
                    {s.ipAddress ?? 'Unknown IP'} · signed in{' '}
                    {new Date(s.createdAt).toLocaleString()}
                  </span>
                </span>
              </span>
              {s.token === current ? (
                <Badge tone="success">This device</Badge>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await authClient.revokeSession({ token: s.token });
                    load();
                  }}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg ? (
        <Alert className="mt-4" tone={msg.tone}>
          {msg.text}
        </Alert>
      ) : null}
    </Card>
  );
}

export function SecurityPanels({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <TwoFactorPanel enabled={twoFactorEnabled} />
      <PasskeyPanel />
      <PasswordPanel />
      <SessionsPanel />
    </div>
  );
}
