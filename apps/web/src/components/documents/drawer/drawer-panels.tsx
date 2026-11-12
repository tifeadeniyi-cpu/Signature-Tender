'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowDownUp,
  Ban,
  BellRing,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Fingerprint,
  ListChecks,
  Lock,
  Mail,
  PenLine,
  Pencil,
  RotateCcw,
  Send,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonClass, Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import type { DocumentSummary, DrawerActivity, DrawerSigner } from '@/lib/document-summary-types';
import {
  DrawerEmpty,
  Initials,
  PaperThumb,
  SectionCard,
  SignerStatusLabel,
  StatusPill,
} from './drawer-ui';

export type DrawerTab = 'overview' | 'signers' | 'activity' | 'files' | 'evidence';

const dateFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const timeFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
export const day = (v: string | null) => (v ? dateFmt.format(new Date(v)) : null);
export const when = (v: string | null) => (v ? timeFmt.format(new Date(v)) : null);
const size = (b: number) =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export interface ActionHandlers {
  remind: () => void;
  reminding: boolean;
  cancel: (reason: string) => void;
  cancelling: boolean;
  message: { ok: boolean; text: string } | null;
}

function Meta({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-text">{k}</dt>
          <dd className="min-w-0 break-words text-right font-medium text-heading">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionMessage({ m }: { m: ActionHandlers['message'] }) {
  return m ? (
    <Alert tone={m.ok ? 'success' : 'error'} className="mt-3">
      {m.text}
    </Alert>
  ) : null;
}

function CancelForm({ h, onDone }: { h: ActionHandlers; onDone: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-xl border border-error/30 bg-error-bg/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        h.cancel(reason);
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-heading">
        Reason (optional, shared in the activity log)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal"
        />
      </label>
      <p className="text-xs">Signing links stop working straight away. This cannot be undone.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="sm" loading={h.cancelling}>
          Confirm cancellation
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Keep request
        </Button>
      </div>
    </form>
  );
}

function QuickActions({ d, h }: { d: DocumentSummary; h: ActionHandlers }) {
  const [confirm, setConfirm] = useState(false);
  const has = (a: DocumentSummary['actions'][number]) => d.actions.includes(a);
  const full = 'w-full min-h-11 sm:min-h-10';
  return (
    <SectionCard title="Quick actions">
      <div className="flex flex-col gap-2">
        {has('download_signed') && d.urls.signedDownload ? (
          <a href={d.urls.signedDownload} className={buttonClass('primary', 'md', full)}>
            <Download className="size-4" aria-hidden /> Download Signed Document
          </a>
        ) : null}
        {has('continue_editing') && d.urls.edit ? (
          <Link href={d.urls.edit} className={buttonClass('primary', 'md', full)}>
            <Pencil className="size-4" aria-hidden /> Continue editing
          </Link>
        ) : null}
        {has('send_reminder') ? (
          <Button
            type="button"
            variant={has('download_signed') ? 'secondary' : 'primary'}
            className={full}
            loading={h.reminding}
            onClick={h.remind}
          >
            <BellRing className="size-4" aria-hidden /> Send Reminder
          </Button>
        ) : null}
        <Link href={d.urls.page} className={buttonClass('secondary', 'md', full)}>
          <Eye className="size-4" aria-hidden /> View Document
        </Link>
        {has('view_certificate') && d.evidence.certificateViewUrl ? (
          <a
            href={d.evidence.certificateViewUrl}
            target="_blank"
            rel="noopener"
            className={buttonClass('secondary', 'md', full)}
          >
            <FileCheck2 className="size-4" aria-hidden /> View Evidence Certificate
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {has('send_again') && d.urls.edit ? (
          <Link href={d.urls.edit} className={buttonClass('secondary', 'md', full)}>
            <RotateCcw className="size-4" aria-hidden /> Edit and send again
          </Link>
        ) : null}
        {has('cancel_request') ? (
          confirm ? (
            <CancelForm h={h} onDone={() => setConfirm(false)} />
          ) : (
            <Button
              type="button"
              variant="ghost"
              className={cn(full, 'text-error hover:bg-error-bg')}
              onClick={() => setConfirm(true)}
            >
              <Ban className="size-4" aria-hidden /> Cancel Request
            </Button>
          )
        ) : null}
      </div>
      {has('send_reminder') ? (
        <p className="mt-2 text-xs">
          Reminders go to everyone whose turn it is, with a fresh link. One per hour.
        </p>
      ) : null}
      {d.access === 'view' ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs">
          <Lock className="size-3.5" aria-hidden /> You can view this document. Only people who can
          send documents can change it.
        </p>
      ) : null}
      <ActionMessage m={h.message} />
    </SectionCard>
  );
}

function SignerRowCompact({ s, i }: { s: DrawerSigner; i: number }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Initials
        name={s.name}
        index={i}
        done={['signed', 'approved', 'reviewed'].includes(s.status)}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-heading">{s.name}</p>
        <p className="truncate text-xs">{s.email}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <SignerStatusLabel status={s.status} label={s.statusLabel} />
        {s.doneAt ? <span className="text-[11px]">{when(s.doneAt)}</span> : null}
      </div>
    </li>
  );
}

export function OverviewPanel({
  d,
  h,
  go,
}: {
  d: DocumentSummary;
  h: ActionHandlers;
  go: (t: DrawerTab) => void;
}) {
  const rows: [string, ReactNode][] = [
    ['Created by', d.createdByYou ? `${d.createdBy ?? 'You'} (you)` : (d.createdBy ?? 'Unknown')],
    ['Created on', day(d.createdAt)],
  ];
  if (d.sentAt) rows.push(['Sent', day(d.sentAt)]);
  if (d.completedAt) rows.push(['Completed', day(d.completedAt)]);
  if (d.expiresAt && (d.status === 'in_progress' || d.status === 'pending'))
    rows.push(['Expires', day(d.expiresAt)]);
  if (d.status === 'expired' && d.closedAt) rows.push(['Expired', day(d.closedAt)]);
  if (d.recipientCount)
    rows.push([
      'Recipients',
      d.actionableCount
        ? `${d.actionableDone} of ${d.actionableCount} completed`
        : `${d.recipientCount} receive a copy`,
    ]);
  rows.push([
    'Pages',
    d.pageCount ? `${d.pageCount} ${d.pageCount === 1 ? 'page' : 'pages'}` : '—',
  ]);
  rows.push(['Document type', d.typeLabel]);
  rows.push([
    'Document ID',
    <span key="r" className="font-mono text-xs">
      {d.reference}
    </span>,
  ]);
  if (d.archived) rows.push(['Folder', 'Archived']);

  return (
    <div className="flex flex-col gap-4">
      {d.isTest ? (
        <Alert tone="warning">
          Test request: free, marked TEST everywhere, not for real agreements.
        </Alert>
      ) : null}
      {d.status === 'needs_attention' ? (
        <Alert tone="error">
          Everyone finished, but creating the signed copy failed. Open the document to retry.
        </Alert>
      ) : null}
      {d.purged ? (
        <Alert tone="info">
          The files were deleted after the retention period. Details and activity are kept.
        </Alert>
      ) : null}

      <SectionCard className="bg-gradient-to-br from-ivory to-blush/60">
        <div className="flex items-center gap-4">
          <PaperThumb />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <FileText className="size-3.5" aria-hidden />
              {d.status === 'completed' ? 'Signed document' : 'Document'}
            </p>
            <p className="mt-1 truncate font-semibold text-heading">{d.title}</p>
            <p className="text-xs">
              PDF{d.pageCount ? ` · ${d.pageCount} ${d.pageCount === 1 ? 'page' : 'pages'}` : ''}
            </p>
            <Link
              href={d.urls.page}
              className={buttonClass('primary', 'sm', 'mt-3 min-h-10 sm:min-h-8')}
            >
              <Eye className="size-4" aria-hidden /> View Document
            </Link>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Summary">
        <Meta rows={rows} />
      </SectionCard>

      {d.signers.length ? (
        <SectionCard
          title="Signers"
          action={
            <button
              type="button"
              onClick={() => go('signers')}
              className="text-sm font-semibold text-primary hover:underline"
            >
              View all<span className="sr-only"> signers</span>
            </button>
          }
        >
          <ul className="divide-y divide-border">
            {d.signers.slice(0, 3).map((s, i) => (
              <SignerRowCompact key={s.id} s={s} i={i} />
            ))}
          </ul>
          {d.signers.length > 3 ? (
            <p className="mt-1 text-xs">and {d.signers.length - 3} more</p>
          ) : null}
        </SectionCard>
      ) : null}

      <QuickActions d={d} h={h} />

      <div className="flex gap-3 rounded-2xl bg-primary px-4 py-3.5 text-white">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-rose-gold" aria-hidden />
        <p className="text-sm text-white/90">
          Your document is securely stored with a tamper-evident evidence log and a complete audit
          trail.{' '}
          <Link href="/product#security" className="font-semibold text-white underline">
            Learn more<span className="sr-only"> about security</span>
          </Link>
        </p>
      </div>
    </div>
  );
}

export function SignersPanel({
  d,
  h,
  onActivity,
}: {
  d: DocumentSummary;
  h: ActionHandlers;
  onActivity: (name: string) => void;
}) {
  if (!d.signers.length)
    return (
      <DrawerEmpty title="No recipients yet">
        {d.actions.includes('continue_editing')
          ? 'Add signers when you continue preparing this document.'
          : 'Recipients appear here once the document is prepared.'}
      </DrawerEmpty>
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {d.signingOrder
            ? 'Signing in order, one after another.'
            : 'Everyone can sign in any order.'}
        </p>
        {d.actions.includes('send_reminder') ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={h.reminding}
            onClick={h.remind}
          >
            <BellRing className="size-4" aria-hidden /> Send reminder
          </Button>
        ) : null}
      </div>
      <ActionMessage m={h.message} />
      <ul className="flex flex-col gap-3">
        {d.signers.map((s, i) => {
          const rows: [string, ReactNode][] = [
            ['Role', s.roleLabel],
            ['Status', <SignerStatusLabel key="s" status={s.status} label={s.statusLabel} />],
          ];
          if (s.status !== 'copy') rows.push(['Authentication', s.authLabel]);
          rows.push(['Viewed', when(s.viewedAt) ?? '—']);
          if (s.status !== 'copy')
            rows.push([
              s.status === 'declined' ? 'Declined' : s.role === 'signer' ? 'Signed' : 'Completed',
              when(s.doneAt) ?? '—',
            ]);
          if (s.reminders) rows.push(['Reminders', String(s.reminders)]);
          return (
            <li key={s.id} className="rounded-2xl border border-border bg-white p-4 shadow-card">
              <div className="mb-3 flex items-center gap-3">
                <Initials
                  name={s.name}
                  index={i}
                  done={['signed', 'approved', 'reviewed'].includes(s.status)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-heading">
                    {d.signingOrder && s.status !== 'copy' ? `${s.order}. ` : ''}
                    {s.name}
                  </p>
                  <p className="truncate text-xs">{s.email}</p>
                </div>
              </div>
              <Meta rows={rows} />
              {s.declineReason ? (
                <p className="mt-2 rounded-lg bg-error-bg px-3 py-2 text-xs text-error">
                  Reason: “{s.declineReason}”
                </p>
              ) : null}
              <div className="mt-3 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => onActivity(s.name)}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  View activity<span className="sr-only"> for {s.name}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs">
        Recipients cannot be changed after a request is sent; that keeps the audit history intact.
        To change who signs, cancel and send again.
      </p>
    </div>
  );
}

const ACTIVITY_ICON: Record<DrawerActivity['icon'], typeof Mail> = {
  file: Upload,
  send: Send,
  mail: Mail,
  eye: Eye,
  pen: PenLine,
  check: CheckCircle2,
  x: XCircle,
  download: Download,
  shield: ShieldCheck,
  edit: Pencil,
};
const TONE: Record<DrawerActivity['tone'], string> = {
  success: 'bg-success-bg text-success',
  error: 'bg-error-bg text-error',
  info: 'bg-info-bg text-info',
  neutral: 'bg-blush text-primary',
};

export function ActivityPanel({
  d,
  person,
  clearPerson,
}: {
  d: DocumentSummary;
  person: string | null;
  clearPerson: () => void;
}) {
  const [oldest, setOldest] = useState(false);
  let items = person ? d.activity.filter((a) => a.actor === person) : d.activity;
  if (oldest) items = items.slice().reverse();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {person ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blush px-3 py-1 text-xs font-semibold text-primary">
            {person}
            <button
              type="button"
              onClick={clearPerson}
              className="rounded-full p-0.5 hover:bg-white"
              aria-label={`Show activity for everyone, not just ${person}`}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ) : (
          <p className="text-sm">
            {d.activity.length} {d.activity.length === 1 ? 'event' : 'events'}
          </p>
        )}
        <button
          type="button"
          onClick={() => setOldest((v) => !v)}
          className={buttonClass('ghost', 'sm')}
          aria-label={oldest ? 'Sort newest first' : 'Sort oldest first'}
        >
          <ArrowDownUp className="size-4" aria-hidden /> {oldest ? 'Oldest first' : 'Newest first'}
        </button>
      </div>
      {items.length === 0 ? (
        <DrawerEmpty title="No activity yet">
          {person
            ? `Nothing recorded for ${person} yet.`
            : 'Uploads, sends, views and signatures will appear here as they happen.'}
        </DrawerEmpty>
      ) : (
        <ol className="relative flex flex-col gap-4 pl-1" aria-label="Activity">
          {items.map((a, i) => {
            const Icon = ACTIVITY_ICON[a.icon];
            return (
              <li key={a.id} className="relative flex gap-3">
                {i < items.length - 1 ? (
                  <span
                    className="absolute left-4 top-9 h-[calc(100%-1.25rem)] w-px bg-border"
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    TONE[a.tone],
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-sm font-semibold text-heading">{a.title}</p>
                  {a.description ? <p className="text-xs break-words">{a.description}</p> : null}
                  <p className="text-xs text-slate-text">
                    {a.actor} · <time dateTime={a.at}>{when(a.at)}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function FilesPanel({ d }: { d: DocumentSummary }) {
  return (
    <div className="flex flex-col gap-4">
      {d.purged ? (
        <Alert tone="info">
          The files were deleted after the retention period. Their fingerprints are kept so copies
          can still be checked.
        </Alert>
      ) : null}
      {d.files.length === 0 ? (
        <DrawerEmpty title="No files yet">
          Upload a PDF to start preparing this document.
        </DrawerEmpty>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Files">
          {d.files.map((f) => (
            <li key={f.id} className="rounded-2xl border border-border bg-white p-4 shadow-card">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg',
                    f.kind === 'certificate'
                      ? 'bg-primary text-rose-gold'
                      : f.kind === 'signed'
                        ? 'bg-success-bg text-success'
                        : 'bg-blush text-primary',
                  )}
                  aria-hidden
                >
                  {f.kind === 'certificate' ? (
                    <ShieldCheck className="size-5" />
                  ) : f.kind === 'signed' ? (
                    <FileCheck2 className="size-5" />
                  ) : (
                    <FileText className="size-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-heading">{f.label}</p>
                  <p className="truncate text-xs" title={f.filename}>
                    {f.filename}
                  </p>
                  <p className="mt-0.5 text-xs">
                    {f.type} · {size(f.sizeBytes)} · {day(f.createdAt)}
                  </p>
                </div>
              </div>
              {f.viewUrl && f.downloadUrl ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <a
                    href={f.viewUrl}
                    target="_blank"
                    rel="noopener"
                    className={buttonClass('secondary', 'sm', 'min-h-10 sm:min-h-8 sm:flex-1')}
                  >
                    <Eye className="size-4" aria-hidden /> View
                    <span className="sr-only"> {f.label} (opens in a new tab)</span>
                  </a>
                  <a
                    href={f.downloadUrl}
                    className={buttonClass('secondary', 'sm', 'min-h-10 sm:min-h-8 sm:flex-1')}
                  >
                    <Download className="size-4" aria-hidden /> Download
                    <span className="sr-only"> {f.label}</span>
                  </a>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-start gap-1.5 text-xs">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {d.status === 'draft'
          ? 'To replace the PDF, continue editing the draft.'
          : 'Files are locked once a document is sent, and completed files can never be changed. Every view and download is recorded.'}
      </p>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1', ok ? 'text-success' : 'text-slate-600')}>
      {ok ? (
        <CheckCircle2 className="size-4" aria-hidden />
      ) : (
        <XCircle className="size-4" aria-hidden />
      )}
      {children}
    </span>
  );
}

export function EvidencePanel({ d, go }: { d: DocumentSummary; go: (t: DrawerTab) => void }) {
  const e = d.evidence;
  const rows: [string, ReactNode][] = [
    ['Document status', <StatusPill key="s" status={d.status} label={d.statusLabel} />],
    ['Completed', when(d.completedAt) ?? '—'],
    ['Signers', d.actionableCount ? `${e.signedCount} of ${d.actionableCount}` : '—'],
    ['Signing order', d.requestId ? (d.signingOrder ? 'In order' : 'Any order') : '—'],
    [
      'Consent captured',
      d.actionableCount ? (
        <Check key="c" ok={e.consentCount > 0 && e.consentCount >= e.signedCount}>
          {e.consentCount} of {d.actionableCount}
        </Check>
      ) : (
        '—'
      ),
    ],
    [
      'Audit trail',
      <Check key="a" ok={e.eventCount > 0}>
        {e.eventCount ? `${e.eventCount} evidence events` : 'Starts when sent'}
      </Check>,
    ],
    [
      'Tamper-evident record',
      <Check key="t" ok={Boolean(e.originalSha256)}>
        {e.originalSha256 ? 'SHA-256 fingerprints recorded' : 'Recorded once sent'}
      </Check>,
    ],
    [
      'Reference',
      <span key="r" className="font-mono text-xs">
        {d.reference}
      </span>,
    ],
  ];
  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Evidence summary">
        <Meta rows={rows} />
      </SectionCard>
      {e.originalSha256 ? (
        <SectionCard title="Fingerprints">
          <dl className="flex flex-col gap-2 text-xs">
            {(
              [
                ['Original PDF', e.originalSha256],
                ['Signed document', e.signedSha256],
              ] as const
            ).map(([k, v]) =>
              v ? (
                <div key={k}>
                  <dt className="flex items-center gap-1 font-semibold text-heading">
                    <Fingerprint className="size-3.5" aria-hidden /> {k}
                  </dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px]">{v}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </SectionCard>
      ) : null}
      <div className="flex flex-col gap-2">
        {e.certificateViewUrl ? (
          <a
            href={e.certificateViewUrl}
            target="_blank"
            rel="noopener"
            className={buttonClass('primary', 'md', 'min-h-11 w-full sm:min-h-10')}
          >
            <FileCheck2 className="size-4" aria-hidden /> View Evidence Certificate
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : null}
        {e.certificateDownloadUrl ? (
          <a
            href={e.certificateDownloadUrl}
            className={buttonClass('secondary', 'md', 'min-h-11 w-full sm:min-h-10')}
          >
            <Download className="size-4" aria-hidden /> Download Evidence Certificate
          </a>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 w-full sm:min-h-10"
          onClick={() => go('activity')}
        >
          <ListChecks className="size-4" aria-hidden /> View Audit Trail
        </Button>
      </div>
      {!e.available ? (
        <p className="text-xs">The evidence certificate is created when everyone has finished.</p>
      ) : null}
      <p className="text-xs">
        Signatures are electronic signatures backed by this evidence log and file fingerprints.
        Documents are not sealed with a certificate-based digital signature.
      </p>
    </div>
  );
}
