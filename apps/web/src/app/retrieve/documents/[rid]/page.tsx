import Link from 'next/link';
import { Download, FileCheck2, ShieldCheck, Eye } from 'lucide-react';
import { AppError, getRetrievedRequest, type RetrievedRequestView } from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { readRetrieveSession } from '@/lib/retrieve-session';
import { Card } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { AutoDownload, ViewerOnDemand } from './viewer';

export const metadata = { title: 'Your document' };
export const dynamic = 'force-dynamic';

const EVENT_LABELS: Record<string, string> = {
  'request.created': 'Request prepared',
  'request.sent': 'Request sent',
  'recipient.notified': 'Invitation emailed',
  'recipient.viewed': 'Link opened',
  'recipient.session_started': 'Review started',
  'recipient.code_sent': 'Email code sent',
  'recipient.code_failed': 'Incorrect email code entered',
  'recipient.code_verified': 'Email code verified',
  'recipient.consented': 'Agreed to sign electronically',
  'recipient.signature_adopted': 'Signature adopted',
  'recipient.signed': 'Signed',
  'recipient.approved': 'Approved',
  'recipient.reviewed': 'Review finished',
  'request.completed': 'Completed: signed copy and certificate created',
  'recipient.retrieved': 'Copy downloaded through a verified email',
  'recipient.viewed_copy': 'Copy viewed through a verified email',
  'recipient.downloaded': 'Signed copy downloaded',
  'recipient.link_reissued': 'New signing link issued',
};
const STATUS: Record<string, string> = {
  waiting: 'Waiting',
  notified: 'Invited',
  viewed: 'Opened',
  signed: 'Done',
  declined: 'Declined',
};
const ROLE: Record<string, string> = {
  signer: 'Signer',
  approver: 'Approver',
  reviewer: 'Reviewer',
  cc: 'Receives a copy',
  viewer: 'Viewer',
};

function formatter() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: env().EMAIL_TIMEZONE,
      timeZoneName: undefined,
    });
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
  }
}

/**
 * A completed request as a verified recipient sees it: the signed PDF with page navigation,
 * signer progress, downloads, and an Evidence tab with the certificate and integrity references.
 * Requires a verified-email session for an address the request was sent to.
 */
export default async function RetrievedDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ rid: string }>;
  searchParams: Promise<{ tab?: string; start?: string }>;
}) {
  const { rid } = await params;
  const sp = await searchParams;
  const tab = sp.tab === 'evidence' ? 'evidence' : 'document';
  let view: RetrievedRequestView;
  try {
    view = await getRetrievedRequest(db(), await readRetrieveSession(), rid);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
        <h1 className="font-display text-3xl">Your document</h1>
        <Card className="flex flex-col gap-4 p-6">
          <Alert tone={err.code === 'unauthenticated' ? 'info' : 'error'}>
            {err.code === 'unauthenticated'
              ? 'Your secure session has ended. Use the button in your email again, or verify your email address below.'
              : 'This document is not available to the address you verified.'}
          </Alert>
          <Link href="/retrieve" className={buttonClass('primary')}>
            Get your documents
          </Link>
        </Card>
      </div>
    );
  }

  const r = view.request;
  const fmt = formatter();
  const tz = env().EMAIL_TIMEZONE;
  const signed = view.files.find((f) => f.kind === 'signed');
  const certificate = view.files.find((f) => f.kind === 'certificate');
  const fileUrl = (kind: 'signed' | 'certificate', inline = false) =>
    `/api/retrieve/${r.id}/file?kind=${kind}${inline ? '&view=1' : ''}`;
  const completed = r.status === 'completed';
  if (completed && view.canOpenFiles && !certificate)
    console.error(`[ops-alert] Completed request ${r.id} has no evidence certificate available.`);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-8">
      {sp.start === 'download' && signed && view.canOpenFiles ? (
        <AutoDownload href={fileUrl('signed')} />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{r.title}</h1>
          <p className="text-sm">
            From {r.senderName}
            {r.workspaceName ? ` (${r.workspaceName})` : ''}
            {r.completedAt ? ` · completed ${fmt.format(r.completedAt)} (${tz})` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {r.isTest ? <Badge tone="warning">Test</Badge> : null}
          {completed ? (
            <Badge tone="success">
              <FileCheck2 className="mr-1 inline size-3" aria-hidden />
              Completed
            </Badge>
          ) : (
            <Badge tone="info">In progress</Badge>
          )}
        </div>
      </div>

      {!completed ? (
        <Alert tone="info">
          This document is not complete yet. Check back when everyone has finished.
        </Alert>
      ) : !view.canOpenFiles ? (
        <Alert tone="info">
          The sender has not turned on downloads for this document. Contact them for a copy.
        </Alert>
      ) : (
        <div className="flex flex-wrap gap-2">
          <a href={fileUrl('signed')} className={buttonClass('primary')}>
            <Download className="size-4" aria-hidden /> Download signed document
          </a>
          {certificate ? (
            <a href={fileUrl('certificate')} className={buttonClass('secondary')}>
              <Download className="size-4" aria-hidden /> Download evidence certificate
            </a>
          ) : null}
        </div>
      )}

      <nav className="flex gap-1 border-b border-border" aria-label="Document sections">
        {(
          [
            ['document', 'Document', Eye],
            ['evidence', 'Evidence certificate', ShieldCheck],
          ] as const
        ).map(([key, label, Icon]) => (
          <Link
            key={key}
            href={
              key === 'document'
                ? `/retrieve/documents/${r.id}`
                : `/retrieve/documents/${r.id}?tab=evidence`
            }
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium',
              tab === key ? 'border-primary text-heading' : 'border-transparent hover:text-heading',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'document' ? (
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <Card className="p-4">
            {completed && view.canOpenFiles && signed ? (
              <ViewerOnDemand src={fileUrl('signed', true)} pages={signed.pageCount} />
            ) : (
              <p className="text-sm">
                The signed document can be viewed here once it is available to you.
              </p>
            )}
          </Card>
          <Card className="h-fit p-4">
            <h2 className="font-display text-xl">Signers</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm" aria-label="Signers">
              {view.signers.map((s, i) => (
                <li key={i} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-medium text-heading">{s.name}</span>
                    <br />
                    <span className="text-xs">{ROLE[s.role] ?? s.role}</span>
                  </span>
                  <Badge tone={s.status === 'signed' ? 'success' : 'neutral'}>
                    {STATUS[s.status] ?? s.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {completed && view.canOpenFiles && !certificate ? (
            <Alert tone="error">
              The evidence certificate is not available right now. Our team has been alerted; please
              try again later.
            </Alert>
          ) : null}
          <Card className="p-4">
            <h2 className="font-display text-xl">Integrity references</h2>
            <p className="mt-1 text-sm">
              SHA-256 fingerprints of the completed files. Anyone can compare a copy against these
              to confirm it has not been changed.
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt>Request</dt>
              <dd className="break-all font-mono text-xs text-heading">{r.id}</dd>
              {signed ? (
                <>
                  <dt>Signed document</dt>
                  <dd className="break-all font-mono text-xs text-heading">{signed.sha256}</dd>
                </>
              ) : null}
              {certificate ? (
                <>
                  <dt>Certificate</dt>
                  <dd className="break-all font-mono text-xs text-heading">{certificate.sha256}</dd>
                </>
              ) : null}
            </dl>
          </Card>
          <Card className="p-4">
            <h2 className="font-display text-xl">Signing events</h2>
            <ol
              className="mt-3 flex flex-col gap-2 border-l-2 border-primary-surface pl-4 text-sm"
              aria-label="Signing events"
            >
              {view.events.map((e, i) => (
                <li key={i}>
                  <p className="font-medium text-heading">{EVENT_LABELS[e.type] ?? e.type}</p>
                  <p className="text-xs">
                    {fmt.format(e.at)} ({tz}) ·{' '}
                    <span className="font-mono">{e.hash.slice(0, 16)}…</span>
                  </p>
                </li>
              ))}
            </ol>
          </Card>
          {completed && view.canOpenFiles && certificate ? (
            <Card className="p-4">
              <h2 className="font-display text-xl">Certificate</h2>
              <ViewerOnDemand src={fileUrl('certificate', true)} pages={certificate.pageCount} />
            </Card>
          ) : null}
        </div>
      )}
      <p className="text-xs">
        Signed in as {view.email} for 30 minutes.{' '}
        <Link href="/retrieve" className="underline">
          All your documents
        </Link>
      </p>
    </div>
  );
}
