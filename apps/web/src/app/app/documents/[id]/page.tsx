import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Download, FileCheck2, Pencil, Archive as ArchiveIcon } from 'lucide-react';
import {
  getSignatureSeals,
  getDocument,
  getRequestsForDocument,
  hasPermission,
  RECIPIENT_ROLES,
  DOCUMENT_TYPES,
  AppError,
  getRequestBilling,
  formatMoney,
  getDocumentRecord,
  isSelfSignRecipients,
} from '@st/core';
import { cn } from '@/lib/cn';
import { ArchiveButton } from '@/components/documents/library-buttons';
import { CheckCopy, LegalHoldForm, PreviewOnDemand } from './record-panels';
import { db } from '@/lib/db';
import { dispatchAfterResponse } from '@/lib/notifications';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { StatusBadge } from '@/components/documents/status-badge';
import { colorFor } from '@/components/documents/colors';
import { RequestActions } from './request-actions';
import { verifyIntegrityAction } from '../actions';
import { EVENT_LABELS } from '@/components/documents/event-labels';
import { PaymentCard } from './payment-card';
import { liveSendingEnabled, paymentsAvailable } from '@/lib/billing';

export const metadata = { title: 'Document' };

const fmt = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
const when = (d: Date | null) => (d ? `${fmt.format(d)} UTC` : null);

const TABS = [
  ['overview', 'Overview'],
  ['signers', 'Signers'],
  ['activity', 'Activity'],
  ['versions', 'Versions'],
] as const;
type Tab = (typeof TABS)[number][0];
const KIND_LABEL: Record<string, string> = {
  original: 'Original upload',
  signed: 'Signed copy',
  certificate: 'Completion certificate',
};
const SOURCE_LABEL = {
  type: 'this document type',
  workspace: 'the workspace default',
  platform: 'the platform default',
};
const dayFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

const RECIPIENT_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'error' }
> = {
  waiting: { label: 'Waiting', tone: 'neutral' },
  notified: { label: 'Invited', tone: 'info' },
  viewed: { label: 'Opened', tone: 'info' },
  signed: { label: 'Done', tone: 'success' },
  declined: { label: 'Declined', tone: 'error' },
};

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string; tab?: string; selfsign?: string }>;
}) {
  const { id } = await params;
  const { checkout, tab: rawTab, selfsign } = await searchParams;
  const tab: Tab = TABS.some(([t]) => t === rawTab) ? (rawTab as Tab) : 'overview';
  const { user, membership } = await requireWorkspace();
  const actor = { userId: user.id };
  let doc;
  try {
    doc = await getDocument(db(), actor, id);
  } catch (err) {
    if (err instanceof AppError && err.code === 'not_found') notFound();
    throw err;
  }
  const requests = await getRequestsForDocument(db(), actor, id);
  if (requests.length === 0) redirect(`/app/documents/${id}/prepare/review`);
  const [current, ...older] = requests;
  const { request: r, recipients } = current!;
  const record = await getDocumentRecord(db(), actor, id);
  const seals =
    r.status === 'completed'
      ? await getSignatureSeals(db(), actor, id, r.id).catch(() => null)
      : null;
  // Picks up any completion email still queued or waiting for a retry (no-op when none are due).
  if (r.status === 'completed') dispatchAfterResponse(r.id);
  const archived = Boolean(record.document.archivedAt);
  const purged = Boolean(record.retention.purgedAt);
  const fileLabel = (f: { kind: string; version: number }) =>
    `${KIND_LABEL[f.kind] ?? f.kind}${f.kind === 'original' && f.version > 1 ? ` (version ${f.version})` : ''}`;
  const visibleFiles = record.files.filter((f) => {
    if (f.kind === 'original') return true;
    const req = record.requests.find(
      (q) => q.signedFileId === f.id || q.certificateFileId === f.id,
    );
    return req?.status === 'completed';
  });
  const previewFile =
    visibleFiles.find((f) => f.id === r.signedFileId && r.status === 'completed') ??
    visibleFiles.find((f) => f.id === r.sourceFileId) ??
    visibleFiles.find((f) => f.kind === 'original');
  const canSend = doc.canEdit && hasPermission(membership.permissions, 'documents.send');
  const open = !['completed', 'declined', 'expired', 'cancelled'].includes(r.status);
  const needsPayment = r.status === 'awaiting_payment' || r.status === 'payment_processing';
  const billing = needsPayment ? await getRequestBilling(db(), actor, r.id) : null;
  // Sign it yourself: your own document waiting for your signature.
  const selfSign = r.sentBy === user.id && isSelfSignRecipients(recipients, user.email);
  const awaitingMe =
    selfSign && ['sent', 'in_progress'].includes(r.status) && recipients[0]?.status !== 'signed';
  const [paymentsOn, liveOn] = needsPayment
    ? await Promise.all([paymentsAvailable(), liveSendingEnabled()])
    : [false, false];

  const recipientsCard = (
    <Card>
      <CardHeader
        title="Recipients"
        description={
          r.signingOrderEnabled
            ? 'Signing in order, one after another.'
            : 'Everyone can sign in any order.'
        }
      />
      <ul className="flex flex-col gap-2">
        {recipients.map((x) => {
          const st = RECIPIENT_STATUS[x.status] ?? RECIPIENT_STATUS.waiting!;
          return (
            <li
              key={x.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2"
              style={{ borderLeft: `4px solid ${colorFor(x.colorIndex).border}` }}
            >
              <span className="font-semibold text-heading">
                {r.signingOrderEnabled ? `${x.signingOrder}. ` : ''}
                {x.name}
              </span>
              <span className="text-sm">{x.email}</span>
              <span className="text-xs">
                {RECIPIENT_ROLES.find((y) => y.value === x.role)?.label}
              </span>
              <span className="ml-auto flex items-center gap-2 text-xs">
                {x.signedAt ? when(x.signedAt) : x.viewedAt ? `Opened ${when(x.viewedAt)}` : null}
                {x.role === 'cc' || x.role === 'viewer' ? (
                  <Badge tone="neutral">Gets a copy</Badge>
                ) : (
                  <Badge tone={st.tone}>{st.label}</Badge>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={doc.document.title}
        description={
          r.sentAt
            ? `Sent ${when(r.sentAt)} by ${r.senderName}`
            : `Prepared by ${r.senderName}. Not sent yet.`
        }
        actions={
          <StatusBadge status={doc.document.status} requestStatus={r.status} isTest={r.isTest} />
        }
      />
      {awaitingMe ? (
        <Card className="mb-6 border-gold">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Ready for your signature</h2>
              <p className="mt-1 text-sm">
                This document is paid for and waiting for you to sign it.
              </p>
            </div>
            {/* A plain link: opening it issues a fresh signing link, so it is never prefetched. */}
            <a href={`/app/documents/${id}/sign-now`} className={buttonClass('gold', 'md')}>
              Sign now
            </a>
          </div>
        </Card>
      ) : null}
      {selfsign ? (
        <Alert tone={selfsign === 'conflict' ? 'info' : 'error'} className="mb-4">
          {selfsign === 'conflict'
            ? 'This document is not ready to sign yet, or it has already been signed.'
            : 'Only the person who prepared this document can sign it here.'}
        </Alert>
      ) : null}
      {r.isTest ? (
        <Alert tone="warning" className="mb-4">
          This is a test request. It is free, marked TEST on every page and email, and is not for
          real agreements.
        </Alert>
      ) : null}
      {needsPayment && billing ? (
        <PaymentCard
          documentId={id}
          requestId={r.id}
          status={r.status as 'awaiting_payment' | 'payment_processing'}
          price={
            billing.price ? formatMoney(billing.price.amountCents, billing.price.currency) : ''
          }
          available={billing.balances?.available ?? 0}
          canPay={billing.canManage && canSend}
          paymentsOn={paymentsOn}
          liveOn={liveOn}
          cancelled={checkout === 'cancelled'}
          selfSign={billing.selfSign}
        />
      ) : null}
      {r.status === 'finalization_failed' ? (
        <Alert tone="error" className="mb-4">
          Everyone finished, but creating the signed copy failed. The document is not shown as
          completed until it succeeds.
        </Alert>
      ) : null}
      {r.status === 'declined' ? (
        <Alert tone="error" className="mb-4">
          {recipients.find((x) => x.status === 'declined')?.name ?? 'A recipient'} declined to sign
          {recipients.find((x) => x.status === 'declined')?.declineReason
            ? `: "${recipients.find((x) => x.status === 'declined')?.declineReason}"`
            : '.'}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <nav aria-label="Document sections">
            <ul className="flex gap-1 overflow-x-auto border-b border-border">
              {TABS.map(([t, label]) => (
                <li key={t} className="shrink-0">
                  <Link
                    href={`/app/documents/${id}${t === 'overview' ? '' : `?tab=${t}`}`}
                    aria-current={tab === t ? 'page' : undefined}
                    className={cn(
                      '-mb-px block border-b-2 px-3 py-2 text-sm',
                      tab === t
                        ? 'border-primary font-semibold text-primary-dark'
                        : 'border-transparent text-heading hover:border-border',
                    )}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {tab === 'overview' ? (
            <>
              {recipientsCard}
              <Card>
                <CardHeader
                  title="Preview"
                  description={previewFile ? fileLabel(previewFile) : undefined}
                />
                {purged ? (
                  <Alert tone="info">
                    The files for this record were deleted after its retention period. The details
                    and activity below are kept.
                  </Alert>
                ) : previewFile ? (
                  <PreviewOnDemand
                    src={`/api/documents/${id}/versions/${previewFile.id}?view=1`}
                    label={previewFile.kind === 'signed' ? 'signed copy' : 'document'}
                    seals={previewFile.kind === 'signed' ? seals : null}
                    checkIntegrity={verifyIntegrityAction}
                  />
                ) : null}
              </Card>
              <Card>
                <CardHeader title="Overview" />
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                  <dt>Type</dt>
                  <dd className="text-heading">
                    {DOCUMENT_TYPES.find((d) => d.value === record.document.documentType)?.label ??
                      'Document'}
                  </dd>
                  <dt>Owner</dt>
                  <dd className="text-heading">{record.ownerName ?? 'Unknown'}</dd>
                  <dt>Created</dt>
                  <dd className="text-heading">{when(record.document.createdAt)}</dd>
                  <dt>Pages</dt>
                  <dd className="text-heading">{record.document.pageCount ?? '—'}</dd>
                  <dt>Signers</dt>
                  <dd className="text-heading">
                    {recipients.filter((x) => x.role !== 'cc' && x.role !== 'viewer').length} of{' '}
                    {recipients.length} recipients sign
                  </dd>
                  {r.completedAt ? (
                    <>
                      <dt>Completed</dt>
                      <dd className="text-heading">{when(r.completedAt)}</dd>
                    </>
                  ) : null}
                  {archived ? (
                    <>
                      <dt>Archived</dt>
                      <dd className="text-heading">{when(record.document.archivedAt)}</dd>
                    </>
                  ) : null}
                </dl>
              </Card>
            </>
          ) : null}
          {tab === 'signers' ? (
            <>
              {recipientsCard}
              {older.length ? (
                <Card>
                  <CardHeader title="Earlier requests" />
                  <ul className="text-sm">
                    {older.map((o) => (
                      <li
                        key={o.request.id}
                        className="flex justify-between border-b border-border py-2 last:border-0"
                      >
                        <span>Sent {when(o.request.sentAt)}</span>
                        <StatusBadge
                          status={doc.document.status}
                          requestStatus={o.request.status}
                          isTest={o.request.isTest}
                        />
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : null}
          {tab === 'activity' ? (
            <Card>
              <CardHeader
                title="Activity"
                description="Signing steps come from the tamper-evident evidence log. Changes, views and downloads come from the audit log."
              />
              <ol
                className="flex flex-col gap-3 border-l-2 border-primary-surface pl-4"
                aria-label="Activity"
              >
                {record.activity
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <li key={`${e.source}-${i}`} className="text-sm">
                      <p className="font-medium text-heading">
                        {EVENT_LABELS[e.type] ?? e.type}
                        {e.type.startsWith('document.file_') && typeof e.data.kind === 'string' ? (
                          <span className="font-normal">
                            : {(KIND_LABEL[e.data.kind] ?? e.data.kind).toLowerCase()}
                          </span>
                        ) : null}
                        {e.recipientName ? (
                          <span className="font-normal"> · {e.recipientName}</span>
                        ) : e.actorName ? (
                          <span className="font-normal"> · {e.actorName}</span>
                        ) : null}
                      </p>
                      <p className="text-xs">
                        {when(e.at)}
                        {e.ipAddress ? ` · IP ${e.ipAddress}` : ''}
                        {e.source === 'audit' ? ' · audit log' : ''}
                        {e.source === 'email' && typeof e.data.to === 'string'
                          ? ` · to ${e.data.to}`
                          : ''}
                      </p>
                      {e.source === 'email' && typeof e.data.error === 'string' ? (
                        <p className="text-xs text-error">{e.data.error}</p>
                      ) : null}
                    </li>
                  ))}
              </ol>
            </Card>
          ) : null}
          {tab === 'versions' ? (
            <Card>
              <CardHeader
                title="Versions"
                description="Every stored file for this document. Each download is checked against its fingerprint and recorded."
              />
              {purged ? (
                <Alert tone="info" className="mb-3">
                  The files were deleted after the retention period. Their fingerprints are kept so
                  copies can still be checked.
                </Alert>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-border text-xs uppercase tracking-wide text-heading">
                    <tr>
                      <th scope="col" className="py-2 pr-3">
                        File
                      </th>
                      <th scope="col" className="py-2 pr-3">
                        Created
                      </th>
                      <th scope="col" className="py-2 pr-3">
                        Fingerprint (SHA-256)
                      </th>
                      <th scope="col" className="py-2">
                        <span className="sr-only">Download</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleFiles.map((f) => (
                      <tr key={f.id}>
                        <td className="py-2 pr-3 font-medium text-heading">{fileLabel(f)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {dayFmt.format(f.createdAt)}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs" title={f.sha256}>
                          {f.sha256.slice(0, 16)}…
                        </td>
                        <td className="py-2 text-right">
                          {purged ? null : (
                            <a
                              href={`/api/documents/${id}/versions/${f.id}`}
                              className={buttonClass('ghost', 'sm')}
                              aria-label={`Download ${fileLabel(f)}`}
                            >
                              <Download className="size-4" aria-hidden /> Download
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 border-t border-border pt-4">
                <CheckCopy
                  known={visibleFiles.map((f) => ({
                    label: fileLabel(f).toLowerCase(),
                    sha256: f.sha256,
                  }))}
                />
              </div>
            </Card>
          ) : null}
        </div>
        <aside className="flex h-fit flex-col gap-4 lg:sticky lg:top-4">
          {r.status === 'completed' ? (
            <Card>
              <h2 className="flex items-center gap-2 font-display text-xl">
                <FileCheck2 className="size-5 text-success" aria-hidden /> Completed
              </h2>
              <p className="mt-1 text-sm">{when(r.completedAt)}</p>
              {r.certificateNumber && r.verificationRef ? (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-slate-text">Certificate</dt>
                  <dd className="font-mono text-xs text-heading">{r.certificateNumber}</dd>
                  <dt className="text-slate-text">Verify</dt>
                  <dd>
                    <a
                      href={`/verify?ref=${r.verificationRef}`}
                      className="font-mono text-xs font-semibold text-primary underline"
                    >
                      {r.verificationRef}
                    </a>
                  </dd>
                </dl>
              ) : null}
              <div className="mt-4 flex flex-col gap-2">
                <a
                  href={`/api/requests/${r.id}/file?kind=package`}
                  className={buttonClass('primary')}
                >
                  <Download className="size-4" aria-hidden /> Download complete package
                </a>
                <a
                  href={`/api/requests/${r.id}/file?kind=signed`}
                  className={buttonClass('secondary')}
                >
                  <Download className="size-4" aria-hidden /> Download signed copy
                </a>
                <a
                  href={`/api/requests/${r.id}/file?kind=certificate`}
                  className={buttonClass('secondary')}
                >
                  <Download className="size-4" aria-hidden /> Download certificate
                </a>
                <p className="text-xs">
                  The complete package is the signed agreement followed by its Certificate of
                  Completion.
                </p>
              </div>
            </Card>
          ) : null}
          <Card>
            <h2 className="font-display text-xl">Details</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt>Reference</dt>
              <dd className="truncate font-mono text-xs text-heading" title={r.id}>
                {r.id}
              </dd>
              <dt>Expires</dt>
              <dd className="text-heading">{when(r.expiresAt) ?? 'No expiration'}</dd>
              <dt>Original</dt>
              <dd className="truncate font-mono text-xs text-heading" title={r.sourceSha256}>
                {r.sourceSha256.slice(0, 20)}…
              </dd>
            </dl>
            <RequestActions
              documentId={id}
              requestId={r.id}
              canSend={canSend}
              open={open}
              status={r.status}
            />
          </Card>
          <Card>
            <h2 className="font-display text-xl">Retention</h2>
            <p className="mt-2 text-sm">
              {record.retention.purgedAt
                ? `Files deleted ${when(record.retention.purgedAt)} after the retention period.`
                : record.retention.keepUntil
                  ? `Kept until ${dayFmt.format(record.retention.keepUntil)} (${record.retention.days} days, from ${SOURCE_LABEL[record.retention.source]}).`
                  : `Kept for ${record.retention.days} days after it is completed or closed (${SOURCE_LABEL[record.retention.source]}).`}
            </p>
            {record.retention.legalHold && !record.canManage ? (
              <p className="mt-2 text-sm font-medium text-heading">On legal hold.</p>
            ) : null}
            {record.canManage ? (
              <LegalHoldForm
                documentId={id}
                hold={record.retention.legalHold}
                reason={record.retention.legalHoldReason}
              />
            ) : null}
          </Card>
          {!open ? (
            <div className="flex items-center gap-2 text-sm">
              {archived ? <ArchiveIcon className="size-4 text-primary" aria-hidden /> : null}
              <ArchiveButton
                documentId={id}
                archived={archived}
                title={doc.document.title}
                size="md"
              />
            </div>
          ) : null}
          {!open && r.status !== 'completed' && canSend ? (
            <Link href={`/app/documents/${id}/prepare/review`} className={buttonClass('secondary')}>
              <Pencil className="size-4" aria-hidden /> Edit and send again
            </Link>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
