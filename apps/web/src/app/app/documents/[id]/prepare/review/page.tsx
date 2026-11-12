import Link from 'next/link';
import { CircleCheck, CircleAlert, Pencil } from 'lucide-react';
import {
  getSpecializedNotice,
  checkReadiness,
  isFeatureEnabled,
  hasPermission,
  getSendQuote,
  formatMoney,
  DOCUMENT_TYPES,
  RECIPIENT_ROLES,
} from '@st/core';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { liveSendingEnabled } from '@/lib/billing';
import { loadPreparation } from '@/lib/documents';
import { PrepareHeader } from '@/components/documents/prepare-header';
import { Card } from '@/components/ui/card';
import { colorFor } from '@/components/documents/colors';
import { ReviewActions } from './review-actions';

export const metadata = { title: 'Review' };

const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export default async function ReviewStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadPreparation(id);
  const { document: doc, file, recipients, fields } = data;
  const s = doc.settings;
  const issues = checkReadiness({ file, recipients, fields, settings: s });
  const appEnv = env().APP_ENV;
  const notice = await getSpecializedNotice(db());
  const testSending = await isFeatureEnabled(db(), 'test_signing', appEnv);
  const liveSending = await liveSendingEnabled();
  const canSend = data.canEdit && hasPermission(data.membership.permissions, 'documents.send');
  const sendBlockedReason = !canSend
    ? 'Your role does not allow sending documents.'
    : !testSending && !liveSending
      ? 'Sending real signing requests opens after security and legal review, and once checkout is switched on.'
      : null;
  const quote =
    canSend && liveSending
      ? await getSendQuote(db(), { userId: data.user.id }, doc.workspaceId)
      : null;
  const liveNote = quote
    ? quote.balances.available > 0
      ? `Uses 1 credit. Your workspace has ${quote.balances.available} available.`
      : `You have no credits. After you press send you can pay ${formatMoney(quote.price.amountCents, quote.price.currency)} for this request${quote.canBuy ? '' : ' (a workspace owner or admin must pay)'}. Nothing is emailed until payment is confirmed.`
    : null;

  const edit = (step: string) => (
    <Link
      href={`/app/documents/${id}/prepare/${step}`}
      className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
    >
      <Pencil className="size-3.5" aria-hidden /> Edit
    </Link>
  );

  return (
    <>
      <PrepareHeader
        documentId={id}
        title={doc.title}
        status={doc.status}
        step="review"
        canEdit={data.canEdit}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <Card>
            <Row title="Document" action={edit('document')}>
              <p className="text-heading">{doc.title}</p>
              <p className="text-sm">
                {DOCUMENT_TYPES.find((t) => t.value === doc.documentType)?.label ?? 'No type'} ·{' '}
                {file?.pageCount ?? 0} {file?.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                {file?.originalFilename}
              </p>
            </Row>
          </Card>
          <Card>
            <Row title={`Recipients (${recipients.length})`} action={edit('signers')}>
              {doc.signingOrderEnabled ? (
                <p className="mb-2 text-sm">Signing in order, one after another.</p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {recipients.map((r) => {
                  const c = colorFor(r.colorIndex);
                  const count = fields.filter((f) => f.recipientId === r.id).length;
                  return (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-border px-3 py-2"
                      style={{ borderLeft: `4px solid ${c.border}` }}
                    >
                      <span className="font-semibold text-heading">
                        {doc.signingOrderEnabled ? `${r.signingOrder}. ` : ''}
                        {r.name}
                      </span>
                      <span className="text-sm">{r.email}</span>
                      <span className="ml-auto text-xs">
                        {RECIPIENT_ROLES.find((x) => x.value === r.role)?.label} · {count}{' '}
                        {count === 1 ? 'field' : 'fields'}
                      </span>
                    </li>
                  );
                })}
                {recipients.length === 0 ? <li className="text-sm">No recipients yet.</li> : null}
              </ul>
            </Row>
          </Card>
          <Card>
            <Row title="Settings" action={edit('settings')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <dt>Signing method</dt>
                <dd className="text-heading">
                  {
                    {
                      electronic_signature: 'Electronic signature',
                      initials_only: 'Initials only',
                      acknowledge: 'Acknowledge',
                    }[s.signingMethod]
                  }
                </dd>
                <dt>Reminders</dt>
                <dd className="text-heading">
                  {s.reminderEnabled ? `Every ${s.reminderEveryDays} days` : 'Off'}
                </dd>
                <dt>Expires</dt>
                <dd className="text-heading">
                  {s.expiresAt ? fmt.format(new Date(`${s.expiresAt}T00:00:00Z`)) : 'No expiration'}
                </dd>
                <dt>Download / print</dt>
                <dd className="text-heading">
                  {s.allowDownload ? 'Download allowed' : 'No download'},{' '}
                  {s.allowPrint ? 'print allowed' : 'no print'}
                </dd>
                <dt>Emailed code</dt>
                <dd className="text-heading">
                  {s.requireSignerAuth ? 'Required' : 'Not required'}
                </dd>
              </dl>
              {doc.emailMessage ? (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-ivory p-3 text-sm">
                  {doc.emailMessage}
                </p>
              ) : null}
            </Row>
          </Card>
        </div>
        <aside className="flex h-fit flex-col gap-4 lg:sticky lg:top-4">
          <Card>
            <h2 className="font-display text-xl">Ready to send?</h2>
            {issues.length === 0 ? (
              <p className="mt-3 flex items-start gap-2 text-sm text-success">
                <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Everything needed is
                in place.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2" aria-label="Things to fix">
                {issues.map((i) => (
                  <li key={i.message} className="flex items-start gap-2 text-sm text-error">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <Link href={`/app/documents/${id}/prepare/${i.step}`} className="underline">
                      {i.message}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 border-t border-border pt-4 text-sm">
              Cost to send: <strong className="text-heading">1 signing request credit</strong>
              {testSending ? (
                <span className="block text-xs">Test requests in this environment are free.</span>
              ) : null}
            </p>
            <ReviewActions
              documentId={id}
              canEdit={data.canEdit}
              ready={issues.length === 0}
              status={doc.status}
              sendBlockedReason={sendBlockedReason}
              testEnabled={testSending}
              liveNote={liveNote}
              notice={notice}
            />
            {data.previousRequest ? (
              <p className="mt-3 text-xs">
                An earlier request was {data.previousRequest.request.status}.{' '}
                <Link href={`/app/documents/${id}`} className="underline">
                  View its history
                </Link>
              </p>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({
  title,
  action,
  children,
}: {
  title: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-xl">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
