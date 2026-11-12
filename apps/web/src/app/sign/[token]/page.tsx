import { CircleCheck, CircleX, Clock, Ban, Download, Mail } from 'lucide-react';
import { getSignerView, getSigningWorkspace, AppError, type SignerView } from '@st/core';
import { db } from '@/lib/db';
import { requestMeta } from '@/lib/session';
import { readSignSession } from '@/lib/sign-session';
import { buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SIGNATURE_FONTS } from '../fonts';
import { StartCard, VerifyCard, ConsentCard } from './stages';
import { SigningWorkspace } from './signing-workspace';

export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

function Shell({ children, test }: { children: React.ReactNode; test?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      {test ? (
        <Alert tone="warning" className="mb-4">
          Test request from a non-production environment. Not for real agreements.
        </Alert>
      ) : null}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-card sm:p-8">
        {children}
      </div>
    </div>
  );
}

function Status({
  icon,
  title,
  children,
  test,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  test?: boolean;
}) {
  return (
    <Shell test={test}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="flex size-12 items-center justify-center rounded-full bg-blush text-primary"
          aria-hidden
        >
          {icon}
        </div>
        <h1 className="font-display text-2xl">{title}</h1>
        {children ? <div className="text-sm">{children}</div> : null}
      </div>
    </Shell>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await readSignSession(token);
  let view: SignerView;
  try {
    view = await getSignerView(db(), token, session, await requestMeta());
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') {
      return (
        <Status icon={<Ban className="size-5" />} title="This link is not available">
          It may have expired, been replaced by a newer email, or the request was cancelled. Ask the
          sender for a new link.
        </Status>
      );
    }
    throw err;
  }
  const t = view.isTest;

  switch (view.stage) {
    case 'start':
      return (
        <Shell test={t}>
          <StartCard
            token={token}
            view={{ ...view, expiresLabel: view.expiresAt ? fmt.format(view.expiresAt) : null }}
          />
        </Shell>
      );
    case 'verify':
      return (
        <Shell test={t}>
          <VerifyCard token={token} email={view.recipient.email} />
        </Shell>
      );
    case 'consent':
      return (
        <Shell test={t}>
          <ConsentCard token={token} title={view.title} disclosure={view.disclosure} />
        </Shell>
      );
    case 'sign': {
      const data = await getSigningWorkspace(db(), token, session);
      return (
        <SigningWorkspace
          token={token}
          title={view.title}
          senderName={view.senderName}
          isTest={t}
          data={data}
          fonts={SIGNATURE_FONTS.map((f) => ({
            id: f.id,
            family: f.family,
            className: f.className,
          }))}
        />
      );
    }
    case 'signed_waiting':
      return (
        <Status icon={<CircleCheck className="size-5" />} title="You're done" test={t}>
          Your part of &ldquo;{view.title}&rdquo; is recorded. We&apos;ll email you when everyone
          has finished.
        </Status>
      );
    case 'completed':
      return (
        <Status
          icon={<CircleCheck className="size-5" />}
          title="This document is complete"
          test={t}
        >
          <p>Everyone has finished &ldquo;{view.title}&rdquo;.</p>
          {view.canDownloadSigned ? (
            <a href={`/api/sign/${token}/signed`} className={buttonClass('primary', 'md', 'mt-4')}>
              <Download className="size-4" aria-hidden /> Download signed copy
            </a>
          ) : (
            <p className="mt-2">
              The sender has not enabled downloads. Contact {view.senderName} for a copy.
            </p>
          )}
        </Status>
      );
    case 'declined':
      return (
        <Status icon={<CircleX className="size-5" />} title="Signing was declined" test={t}>
          This request was declined, so no one can sign it now. {view.senderName} has been told.
        </Status>
      );
    case 'expired':
      return (
        <Status icon={<Clock className="size-5" />} title="This request has expired" test={t}>
          Ask {view.senderName} to send it again if you still need to sign.
        </Status>
      );
    case 'cancelled':
      return (
        <Status icon={<Ban className="size-5" />} title="This request was cancelled" test={t}>
          {view.senderName} cancelled this request. No action is needed.
        </Status>
      );
    default:
      return (
        <Status icon={<Mail className="size-5" />} title="Nothing to sign yet" test={t}>
          You&apos;ll receive an email when the document is ready for you.
        </Status>
      );
  }
}
