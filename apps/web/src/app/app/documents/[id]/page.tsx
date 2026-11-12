import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Download, FileCheck2, Pencil } from 'lucide-react';
import {
  getDocument,
  getRequestsForDocument,
  hasPermission,
  RECIPIENT_ROLES,
  AppError,
  getRequestBilling,
  formatMoney,
} from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { StatusBadge } from '@/components/documents/status-badge';
import { colorFor } from '@/components/documents/colors';
import { RequestActions } from './request-actions';
import { PaymentCard } from './payment-card';
import { liveSendingEnabled, paymentsAvailable } from '@/lib/billing';

export const metadata = { title: 'Document' };

const fmt = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
const when = (d: Date | null) => (d ? `${fmt.format(d)} UTC` : null);

const EVENT_LABELS: Record<string, string> = {
  'request.created': 'Request prepared',
  'request.awaiting_payment': 'Waiting for payment',
  'request.sent': 'Request sent',
  'recipient.notified': 'Invitation emailed',
  'recipient.viewed': 'Opened the link',
  'recipient.session_started': 'Started reviewing',
  'recipient.code_sent': 'Email code sent',
  'recipient.code_failed': 'Entered an incorrect code',
  'recipient.code_verified': 'Verified email code',
  'recipient.consented': 'Agreed to sign electronically',
  'recipient.signature_adopted': 'Adopted a signature',
  'recipient.signed': 'Signed',
  'recipient.approved': 'Approved',
  'recipient.reviewed': 'Finished review',
  'recipient.declined': 'Declined to sign',
  'recipient.downloaded': 'Downloaded the signed copy',
  'request.completed': 'Completed: signed copy and certificate created',
  'request.cancelled': 'Request cancelled',
  'request.expired': 'Request expired',
  'request.finalization_failed': 'Creating the signed copy failed',
};

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
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { id } = await params;
  const { checkout } = await searchParams;
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
  const { request: r, recipients, events } = current!;
  const canSend = doc.canEdit && hasPermission(membership.permissions, 'documents.send');
  const open = !['completed', 'declined', 'expired', 'cancelled'].includes(r.status);
  const nameOf = new Map(recipients.map((x) => [x.id, x.name]));
  const needsPayment = r.status === 'awaiting_payment' || r.status === 'payment_processing';
  const billing = needsPayment ? await getRequestBilling(db(), actor, r.id) : null;
  const [paymentsOn, liveOn] = needsPayment
    ? await Promise.all([paymentsAvailable(), liveSendingEnabled()])
    : [false, false];

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
                      {x.signedAt
                        ? when(x.signedAt)
                        : x.viewedAt
                          ? `Opened ${when(x.viewedAt)}`
                          : null}
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
          <Card>
            <CardHeader
              title="History"
              description="Every step is recorded in a tamper-evident log."
            />
            <ol className="flex flex-col gap-3 border-l-2 border-primary-surface pl-4">
              {events
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.seq} className="text-sm">
                    <p className="font-medium text-heading">
                      {EVENT_LABELS[e.type] ?? e.type}
                      {e.recipientId ? (
                        <span className="font-normal"> · {nameOf.get(e.recipientId)}</span>
                      ) : e.actorUserId ? (
                        <span className="font-normal"> · {r.senderName}</span>
                      ) : null}
                    </p>
                    <p className="text-xs">
                      {when(e.createdAt)}
                      {e.ipAddress ? ` · IP ${e.ipAddress}` : ''}
                    </p>
                  </li>
                ))}
            </ol>
          </Card>
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
        </div>
        <aside className="flex h-fit flex-col gap-4 lg:sticky lg:top-4">
          {r.status === 'completed' ? (
            <Card>
              <h2 className="flex items-center gap-2 font-display text-xl">
                <FileCheck2 className="size-5 text-success" aria-hidden /> Completed
              </h2>
              <p className="mt-1 text-sm">{when(r.completedAt)}</p>
              <div className="mt-4 flex flex-col gap-2">
                <a
                  href={`/api/requests/${r.id}/file?kind=signed`}
                  className={buttonClass('primary')}
                >
                  <Download className="size-4" aria-hidden /> Download signed copy
                </a>
                <a
                  href={`/api/requests/${r.id}/file?kind=certificate`}
                  className={buttonClass('secondary')}
                >
                  <Download className="size-4" aria-hidden /> Download certificate
                </a>
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
