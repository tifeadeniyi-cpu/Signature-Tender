import Link from 'next/link';
import { CircleCheck, CircleX, Clock, Ban, Download, Mail, Eye, Hourglass } from 'lucide-react';
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
import { purchasedForSigner } from '@/lib/studio';
import { buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SIGNATURE_FONTS } from '../fonts';
import { VerifyCard, ConsentCard } from './stages';
import { SigningWorkspace } from './signing-workspace';
import { Landing } from './landing';
import { PreviewModal } from './preview-modal';
import { SignChrome } from '../sign-chrome';

export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const fmtTime = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'UTC',
});

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
        <SignChrome>
          <Status icon={<Ban className="size-5" />} title="This link is not available">
            It may have expired, been replaced by a newer email, or the request was cancelled. Ask
            the sender for a new link.
          </Status>
        </SignChrome>
      );
    }
    throw err;
  }
  const brand = await getBrand(db(), view.workspaceId).catch(() => null);
  if (view.stage === 'sign') return stage(view, token, session, preview);
  return (
    <SignChrome>
      {brand ? <BrandBar brand={brand} workspaceId={view.workspaceId} /> : null}
      {await stage(view, token, session, preview)}
    </SignChrome>
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
      const [data, purchased] = await Promise.all([
        getSigningWorkspace(db(), token, session, await requestMeta()),
        purchasedForSigner(view.recipient.email),
      ]);
      return (
        <SigningWorkspace
          token={token}
          title={view.title}
          senderName={view.senderName}
          isTest={t}
          authMethod={view.recipient.authMethod}
          today={fmtShort.format(new Date())}
          data={data}
          fonts={SIGNATURE_FONTS.map((f) => ({ id: f.id, family: f.family }))}
          purchased={purchased}
        />
      );
    }
    case 'waiting_turn':
      return (
        <Status icon={<Hourglass className="size-5" />} title="It's Not Your Turn Yet" test={t}>
          Others need to sign &ldquo;{view.title}&rdquo; before you. We&apos;ll email you when
          it&apos;s ready for you.
        </Status>
      );
    case 'signed_waiting':
    case 'completed':
      return <Success view={view} token={token} />;
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

/**
 * Shown after this recipient submits, and to anyone opening the link later. It separates "your
 * signing is complete" from "all parties have completed", and never offers the signed copy before
 * it has been generated and stored.
 */
function Success({ view, token }: { view: SignerView; token: string }) {
  const done = view.stage === 'completed';
  const ready = view.canDownloadSigned;
  const status = done
    ? 'All parties have completed the document'
    : view.allPartiesDone
      ? 'All parties have signed. The final signed copy is being prepared.'
      : 'Waiting for other parties to finish';
  return (
    <Shell test={view.isTest}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="flex size-14 items-center justify-center rounded-full bg-success-bg text-success"
          aria-hidden
        >
          <CircleCheck className="size-7" />
        </div>
        <h1 className="font-display text-3xl">
          {done && !view.signedAt ? 'This document is complete' : "You've Completed Your Signing"}
        </h1>
        <p className="text-sm">
          {view.signedAt
            ? 'Your signature has been submitted successfully.'
            : `Everyone has finished "${view.title}".`}
        </p>
      </div>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-ivory p-4 text-sm">
        <dt>Document</dt>
        <dd className="font-semibold text-heading">{view.title}</dd>
        <dt>Recipient</dt>
        <dd className="text-heading">{view.recipient.name}</dd>
        {view.signedAt ? (
          <>
            <dt>Completed</dt>
            <dd className="text-heading">{fmtTime.format(view.signedAt)} UTC</dd>
          </>
        ) : null}
        <dt>Status</dt>
        <dd className="text-heading">
          <span className="font-semibold">
            {done || view.allPartiesDone ? '' : 'Your signing is complete. '}
          </span>
          {status}
        </dd>
      </dl>
      {done ? null : (
        <p className="mt-4 text-sm">
          {view.allPartiesDone
            ? "We'll email you when the signed copy is ready."
            : `${view.senderName} and the other recipients will be notified when the entire agreement is complete.`}
        </p>
      )}
      {/* Stacked full width: three buttons side by side did not fit their labels in this card. */}
      <div className="mt-6 flex flex-col gap-2">
        {done ? (
          <Link
            href={`/sign/completed/${token}`}
            className={buttonClass('primary', 'md', 'w-full')}
          >
            View completed document
          </Link>
        ) : null}
        {ready ? (
          <a
            href={`/api/sign/${token}/signed`}
            className={buttonClass(done ? 'secondary' : 'primary', 'md', 'w-full')}
          >
            <Download className="size-4" aria-hidden /> Download signed copy
          </a>
        ) : done ? (
          <p className="text-sm">
            The sender has not enabled downloads. Contact {view.senderName} for a copy.
          </p>
        ) : null}
        <Link href="/" className={buttonClass('ghost', 'md', 'w-full')}>
          Return to Signature Tender homepage
        </Link>
      </div>
      <p className="mt-4 text-center text-xs">You can close this window.</p>
    </Shell>
  );
}
