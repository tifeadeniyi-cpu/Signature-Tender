import Link from 'next/link';
import { CircleCheck, CircleX, Clock, Ban, Download, Mail, Eye } from 'lucide-react';
import {
  getSignerView,
  getSigningWorkspace,
  getBrand,
  AppError,
  type SignerView,
  type Brand,
} from '@st/core';
import { db } from '@/lib/db';
import { requestMeta } from '@/lib/session';
import { readSignSession } from '@/lib/sign-session';
import { buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SIGNATURE_FONTS } from '../fonts';
import { VerifyCard, ConsentCard } from './stages';
import { SigningWorkspace } from './signing-workspace';
import { Landing } from './landing';
import { PreviewModal } from './preview-modal';

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

export default async function SignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const preview = (await searchParams).preview === '1';
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
  const brand = await getBrand(db(), view.workspaceId).catch(() => null);
  return (
    <>
      {brand ? <BrandBar brand={brand} workspaceId={view.workspaceId} /> : null}
      {await stage(view, token, session, preview)}
    </>
  );
}

/**
 * The sending workspace's name, colour and logo. Shown under the Signature Tender header so it
 * never covers the security indicators, the electronic-records disclosure or the signing controls.
 */
function BrandBar({ brand, workspaceId }: { brand: Brand; workspaceId: string }) {
  const name = brand.brandName ?? brand.name;
  return (
    <div
      className="border-b border-border bg-white"
      style={brand.color ? { borderTop: `4px solid ${brand.color}` } : undefined}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
        {brand.hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/brand/${workspaceId}/logo?v=${brand.logoSha256?.slice(0, 12)}`}
            alt=""
            className="h-8 max-w-40 object-contain"
          />
        ) : null}
        <p className="text-sm">
          Sent by <span className="font-semibold text-heading">{name}</span> using Signature Tender
        </p>
      </div>
    </div>
  );
}

async function stage(
  view: SignerView,
  token: string,
  session: string | undefined,
  preview: boolean,
) {
  const t = view.isTest;

  switch (view.stage) {
    case 'start':
      return <Landing token={token} view={view} />;
    case 'verify':
      return (
        <Shell test={t}>
          <VerifyCard token={token} email={view.recipient.email} />
        </Shell>
      );
    case 'consent':
      return (
        <>
          <Shell test={t}>
            <Link
              href={`/sign/${token}?preview=1`}
              replace
              className={buttonClass('secondary', 'md', 'mb-5 w-full')}
            >
              <Eye className="size-4" aria-hidden /> Preview document (read-only)
            </Link>
            <ConsentCard token={token} title={view.title} disclosure={view.disclosure} />
          </Shell>
          {preview ? (
            <PreviewModal token={token} title={view.title} pageCount={view.pageCount} />
          ) : null}
        </>
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
        <Status
          icon={<Clock className="size-5" />}
          title="This Signing Invitation Has Expired"
          test={t}
        >
          <p>
            The time to respond to &ldquo;{view.title}&rdquo; has passed
            {view.expiresAt ? ` (it expired ${fmt.format(view.expiresAt)})` : ''}, so it can no
            longer be signed from this link.
          </p>
          <p className="mt-2">
            Ask {view.senderName} ({view.senderEmail}) to send it again if you still need to sign.
          </p>
        </Status>
      );
    case 'cancelled':
      return (
        <Status icon={<Ban className="size-5" />} title="This request was cancelled" test={t}>
          {view.senderName} cancelled this request. No action is needed.
        </Status>
      );
    default:
      if (view.recipient.role === 'cc' || view.recipient.role === 'viewer')
        return (
          <Status icon={<Mail className="size-5" />} title="You're receiving a copy" test={t}>
            {view.senderName} shared &ldquo;{view.title}&rdquo; with you for your records. There is
            nothing for you to sign. You&apos;ll get an email when everyone has finished.
          </Status>
        );
      return (
        <Status icon={<Mail className="size-5" />} title="Nothing to sign yet" test={t}>
          You&apos;ll receive an email when the document is ready for you.
        </Status>
      );
  }
}
