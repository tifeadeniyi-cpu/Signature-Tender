import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Award,
  CalendarDays,
  CircleCheck,
  Clock,
  Download,
  FileText,
  Hash,
  Loader2,
  UserRound,
  CircleX,
  Ban,
  CircleAlert,
} from 'lucide-react';
import type { CompletedView } from '@st/core';
import { documentReference } from '@/lib/document-summary';
import { cn } from '@/lib/cn';
import { CompletedPdfViewer } from './pdf-viewer';
import { DownloadLink, FinalizingPoller, RetryButton, TrackOnMount } from './client-bits';

const ROLE: Record<string, string> = {
  signer: 'Signer',
  approver: 'Approver',
  reviewer: 'Reviewer',
  cc: 'Receives a copy',
  viewer: 'Viewer',
};
const STATUS: Record<string, string> = {
  waiting: 'Waiting',
  notified: 'Invited',
  viewed: 'Opened',
  declined: 'Declined',
};
const DONE: Record<string, string> = {
  signer: 'Signed',
  approver: 'Approved',
  reviewer: 'Reviewed',
};
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
  'recipient.retrieved': 'Copy downloaded through a verified email or account',
  'recipient.viewed_copy': 'Copy viewed',
  'recipient.downloaded': 'Signed copy downloaded',
  'recipient.link_reissued': 'New signing link issued',
};

export interface CompletedPageProps {
  view: CompletedView;
  /** URL of a completed file. `inline` streams it for the viewer (recorded as a view). */
  fileUrl: (kind: 'signed' | 'certificate', inline?: boolean) => string;
  /** This page without query parameters, used for the evidence toggle. */
  selfHref: string;
  evidence: boolean;
  /** Right column: the account offer, or the signed-in panel. */
  aside: ReactNode;
  /** Where a recipient who still has to act can continue. */
  signHref?: string | null;
  supportEmail: string;
  timeZone: string;
  /** Shown above the layout, e.g. an automatic download notice. */
  notice?: ReactNode;
}

function dateFmt(timeZone: string) {
  const make = (tz: string) => ({
    dateTime: new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: tz,
    }),
    date: new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: tz }),
    time: new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: tz }),
    zone: new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }),
  });
  try {
    return make(timeZone);
  } catch {
    return make('UTC');
  }
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}

/**
 * The completed document view (spec: three columns on desktop, stacked on mobile in the order
 * confirmation, title and status, download, viewer, signers, evidence, account offer). Only
 * shows the "completed" message once the server has confirmed finalization.
 */
export function CompletedPage(p: CompletedPageProps) {
  const { view } = p;
  const r = view.request;
  const f = dateFmt(p.timeZone);
  const zoneOf = (d: Date) =>
    f.zone.formatToParts(d).find((x) => x.type === 'timeZoneName')?.value ?? p.timeZone;
  const at = (d: Date) => `${f.dateTime.format(d)} (${zoneOf(d)})`;
  const atLong = (d: Date) => `${f.date.format(d)} at ${f.time.format(d)} (${zoneOf(d)})`;
  const completed = view.state === 'completed';
  const showViewer = completed && view.canOpenFiles && view.files.signed;
  const showEvidence = p.evidence && completed && view.canOpenFiles && view.files.certificate;
  const signedCount = view.signers.filter((s) => s.status === 'signed').length;
  const acting = view.signers.filter((s) => s.role in DONE);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-12 sm:px-6">
      <TrackOnMount
        event="completed_document_page_viewed"
        props={{ state: view.state, access: view.access }}
      />
      {r.isTest ? (
        <p
          role="note"
          className="mx-auto mt-4 max-w-3xl rounded-lg bg-warning-bg px-4 py-2 text-center text-sm font-medium text-warning"
        >
          Test request from a non-production environment. Not for real agreements.
        </p>
      ) : null}

      <Banner
        state={view.state}
        title={r.title}
        senderName={r.senderName}
        progress={`${acting.filter((s) => s.status === 'signed').length} of ${acting.length}`}
        signHref={p.signHref ?? null}
        supportEmail={p.supportEmail}
      />
      {p.notice ? <div className="mx-auto mb-4 max-w-3xl">{p.notice}</div> : null}

      <div className="grid grid-cols-1 gap-y-5 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-0 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        {/* Title, status and (on small screens) the download action. */}
        <section
          aria-label="Document"
          className="rounded-2xl border border-border bg-white p-5 shadow-card lg:col-start-1 lg:row-start-1 lg:rounded-b-none lg:border-b-0 lg:shadow-none"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border border-error/30 bg-error-bg/60 text-error">
              <FileText className="size-5" aria-hidden />
              <span className="text-[9px] font-bold leading-none">PDF</span>
            </span>
            <div className="min-w-0">
              <h2 className="break-words font-display text-xl leading-snug">{r.title}</h2>
              <p className="mt-0.5 text-sm text-heading">
                Document ID: {documentReference(r.documentId)}
              </p>
            </div>
          </div>
          <StatusCard
            state={view.state}
            completedAt={r.completedAt ? atLong(r.completedAt) : null}
          />
          {showViewer ? (
            <DownloadLink
              href={p.fileUrl('signed')}
              from="summary"
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-white hover:bg-primary-hover lg:hidden"
            >
              <Download className="size-5" aria-hidden /> Download signed document
            </DownloadLink>
          ) : null}
        </section>

        {/* Viewer: the largest area. */}
        <section
          id="document"
          tabIndex={-1}
          aria-label={showEvidence ? 'Evidence certificate' : 'Signed document'}
          className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          {showEvidence ? (
            <EvidencePanel view={view} fileUrl={p.fileUrl} selfHref={p.selfHref} at={at} />
          ) : showViewer ? (
            <CompletedPdfViewer
              src={p.fileUrl('signed', true)}
              downloadHref={p.fileUrl('signed')}
              allowPrint={r.allowPrint}
              title={r.title}
            />
          ) : (
            <ViewerPlaceholder view={view} supportEmail={p.supportEmail} />
          )}
        </section>

        {/* Details, signers and evidence. */}
        <section
          aria-label="Document details"
          className="rounded-2xl border border-border bg-white p-5 shadow-card lg:col-start-1 lg:row-start-2 lg:self-start lg:rounded-t-none lg:border-t-0"
        >
          <dl className="flex flex-col gap-4 text-sm">
            <Info icon={<UserRound className="size-5" aria-hidden />} label="From">
              {r.senderName}
              {r.workspaceName ? <span className="block text-xs">{r.workspaceName}</span> : null}
              <span className="block break-all text-xs">({r.senderEmail})</span>
            </Info>
            {r.sentAt ? (
              <Info icon={<CalendarDays className="size-5" aria-hidden />} label="Sent">
                {f.date.format(r.sentAt)}
              </Info>
            ) : null}
            {completed && r.completedAt ? (
              <Info icon={<CircleCheck className="size-5" aria-hidden />} label="Completed">
                {at(r.completedAt)}
              </Info>
            ) : null}
            {view.files.signed?.pageCount ? (
              <Info icon={<FileText className="size-5" aria-hidden />} label="Pages">
                {view.files.signed.pageCount}
              </Info>
            ) : null}
            <Info icon={<Hash className="size-5" aria-hidden />} label="Reference">
              <span className="break-all font-mono text-xs">{r.id}</span>
            </Info>
          </dl>

          <h2 className="mt-6 border-t border-border pt-5 font-display text-xl">
            Signers ({view.signers.length})
          </h2>
          <ul className="mt-3 flex flex-col divide-y divide-border" aria-label="Signers">
            {view.signers.map((s, i) => (
              <li key={i} className="flex items-start gap-3 py-3">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blush font-semibold text-primary"
                  aria-hidden
                >
                  {initials(s.name)}
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-heading">
                    {s.name}
                    {s.isYou ? (
                      <span className="ml-1 font-normal text-slate-500">(you)</span>
                    ) : null}
                  </p>
                  <p className="text-xs">{ROLE[s.role] ?? s.role}</p>
                  {s.status === 'signed' ? (
                    <p className="mt-1 flex items-center gap-1 font-medium text-success">
                      <CircleCheck className="size-4" aria-hidden />
                      {DONE[s.role] ?? 'Done'}
                    </p>
                  ) : s.role === 'cc' ? null : (
                    <p className="mt-1 flex items-center gap-1 font-medium text-warning">
                      <Clock className="size-4" aria-hidden />
                      {STATUS[s.status] ?? s.status}
                    </p>
                  )}
                  {s.signedAt ? <p className="text-xs">{at(s.signedAt)}</p> : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="sr-only">
            {signedCount} of {view.signers.length} participants have finished.
          </p>

          {completed && view.canOpenFiles && view.files.certificate ? (
            showEvidence ? (
              <Link
                href={p.selfHref}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-white font-semibold text-primary hover:bg-blush"
              >
                <ArrowLeft className="size-5" aria-hidden /> Back to the signed document
              </Link>
            ) : (
              <Link
                href={`${p.selfHref}?view=evidence`}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-white font-semibold text-primary hover:bg-blush"
              >
                <Award className="size-5" aria-hidden /> View Evidence Certificate
              </Link>
            )
          ) : null}
        </section>

        {/* Account offer or signed-in panel. */}
        <div className="lg:col-span-2 lg:row-start-3 lg:mt-6 xl:col-span-1 xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:mt-0">
          {p.aside}
        </div>
      </div>
    </div>
  );
}

function Info({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
      <dt className="contents">
        <span className="mt-0.5 text-primary">{icon}</span>
        <span className="font-medium text-heading">{label}</span>
      </dt>
      <dd className="col-start-2 text-heading/80">{children}</dd>
    </div>
  );
}

function StatusCard({
  state,
  completedAt,
}: {
  state: CompletedView['state'];
  completedAt: string | null;
}) {
  if (state === 'completed')
    return (
      <div className="mt-4 rounded-xl border border-success/20 bg-success-bg/50 p-4">
        <p className="flex items-center gap-2 font-display text-lg text-success">
          <CircleCheck className="size-5" aria-hidden /> Completed
        </p>
        {completedAt ? (
          <p className="mt-1 text-sm text-heading">Completed on {completedAt}</p>
        ) : null}
      </div>
    );
  const label: Record<string, string> = {
    finalizing: 'Finalizing',
    you_signed: 'Waiting for others',
    awaiting_you: 'Waiting for you',
    in_progress: 'In progress',
    declined: 'Declined',
    expired: 'Expired',
    cancelled: 'Cancelled',
    unavailable: 'Unavailable',
  };
  const bad = ['declined', 'expired', 'cancelled', 'unavailable'].includes(state);
  return (
    <div
      className={cn(
        'mt-4 rounded-xl border p-4',
        bad ? 'border-border bg-ivory' : 'border-warning/20 bg-warning-bg/50',
      )}
    >
      <p
        className={cn(
          'flex items-center gap-2 font-display text-lg',
          bad ? 'text-heading' : 'text-warning',
        )}
      >
        <Clock className="size-5" aria-hidden /> {label[state] ?? 'In progress'}
      </p>
    </div>
  );
}

function Banner({
  state,
  title,
  senderName,
  progress,
  signHref,
  supportEmail,
}: {
  state: CompletedView['state'];
  title: string;
  senderName: string;
  progress: string;
  signHref: string | null;
  supportEmail: string;
}) {
  const content: Record<
    CompletedView['state'],
    { icon: ReactNode; heading: string; body: ReactNode; tone: 'success' | 'wait' | 'neutral' }
  > = {
    completed: {
      tone: 'success',
      icon: <CircleCheck className="size-9" strokeWidth={2.5} aria-hidden />,
      heading: 'This Document Is Completed',
      body: 'All required parties have signed. You can view, download, and keep a copy of the final document below.',
    },
    finalizing: {
      tone: 'wait',
      icon: <Loader2 className="size-9 motion-safe:animate-spin" aria-hidden />,
      heading: 'Your Document Is Being Finalized',
      body: (
        <>
          Everyone has finished. We&apos;re preparing the signed copy and evidence certificate. This
          page updates on its own.
          <span className="mt-2 block">
            <FinalizingPoller />
          </span>
        </>
      ),
    },
    you_signed: {
      tone: 'success',
      icon: <CircleCheck className="size-9" strokeWidth={2.5} aria-hidden />,
      heading: "You've Completed Your Signing",
      body: (
        <>
          Your part of &ldquo;{title}&rdquo; is recorded. Other participants still need to finish (
          {progress} done), so the agreement is still in progress. We&apos;ll email you when the
          final document is ready.
        </>
      ),
    },
    awaiting_you: {
      tone: 'wait',
      icon: <Clock className="size-9" aria-hidden />,
      heading: 'This Document Is Waiting for You',
      body: (
        <>
          {senderName} is waiting for you to finish &ldquo;{title}&rdquo;.
          {signHref ? (
            <Link
              href={signHref}
              className="mx-auto mt-3 flex h-11 w-fit items-center rounded-lg bg-primary px-5 font-semibold text-white hover:bg-primary-hover"
            >
              Continue to sign
            </Link>
          ) : null}
        </>
      ),
    },
    in_progress: {
      tone: 'wait',
      icon: <Clock className="size-9" aria-hidden />,
      heading: 'This Document Is Still in Progress',
      body: `Not everyone has finished yet (${progress} done). We'll email you when the final document is ready.`,
    },
    declined: {
      tone: 'neutral',
      icon: <CircleX className="size-9" aria-hidden />,
      heading: 'Signing Was Declined',
      body: `This request was declined, so it can't be completed. ${senderName} has been told.`,
    },
    expired: {
      tone: 'neutral',
      icon: <Clock className="size-9" aria-hidden />,
      heading: 'This Request Has Expired',
      body: `It expired before everyone finished. Ask ${senderName} to send it again if needed.`,
    },
    cancelled: {
      tone: 'neutral',
      icon: <Ban className="size-9" aria-hidden />,
      heading: 'This Request Was Cancelled',
      body: `${senderName} cancelled this request. No action is needed.`,
    },
    unavailable: {
      tone: 'neutral',
      icon: <CircleAlert className="size-9" aria-hidden />,
      heading: "We Couldn't Load Your Document",
      body: (
        <>
          The completed files are not available right now.
          <span className="mt-3 flex flex-wrap justify-center gap-2">
            <RetryButton className="h-10 rounded-lg bg-primary px-5 font-semibold text-white hover:bg-primary-hover" />
            <a
              href={`mailto:${supportEmail}`}
              className="flex h-10 items-center rounded-lg border border-border bg-white px-5 font-semibold text-heading hover:bg-blush"
            >
              Help
            </a>
          </span>
        </>
      ),
    },
  };
  const c = content[state];
  return (
    <div
      className="mx-auto flex max-w-3xl flex-col items-center gap-3 py-6 text-center sm:py-8"
      role="status"
    >
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
        <span
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-full text-white shadow-md sm:size-16',
            c.tone === 'success' && 'bg-gradient-to-b from-[#22a04b] to-success',
            c.tone === 'wait' && 'bg-gradient-to-b from-[#d6862a] to-warning',
            c.tone === 'neutral' && 'bg-slate-text',
          )}
        >
          {c.icon}
        </span>
        <h1 className="font-display text-3xl leading-tight sm:text-[2.6rem]">{c.heading}</h1>
      </div>
      <div className="max-w-2xl text-base text-heading/85">{c.body}</div>
    </div>
  );
}

function ViewerPlaceholder({ view, supportEmail }: { view: CompletedView; supportEmail: string }) {
  let text: ReactNode;
  if (view.state === 'completed' && !view.request.allowDownload)
    text = (
      <>
        The sender has not turned on downloads for this document. Contact {view.request.senderName}{' '}
        for a copy.
      </>
    );
  else if (view.state === 'unavailable')
    text = (
      <>
        Try again in a moment. If this keeps happening,{' '}
        <a className="font-semibold text-primary underline" href={`mailto:${supportEmail}`}>
          contact support
        </a>
        .
      </>
    );
  else if (view.state === 'finalizing')
    text = 'The signed document will appear here as soon as it is ready.';
  else if (['you_signed', 'in_progress', 'awaiting_you'].includes(view.state))
    text = 'The final signed document will appear here once everyone has finished.';
  else text = 'There is no completed document for this request.';
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-white/70 p-8 text-center lg:min-h-[60dvh]">
      <FileText className="size-10 text-rose-gold" aria-hidden />
      <p className="max-w-md text-sm">{text}</p>
    </div>
  );
}

function EvidencePanel({
  view,
  fileUrl,
  selfHref,
  at,
}: {
  view: CompletedView;
  fileUrl: CompletedPageProps['fileUrl'];
  selfHref: string;
  at: (d: Date) => string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <TrackOnMount event="evidence_certificate_viewed" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Evidence certificate</h2>
          <p className="text-sm">
            The signing record for this document: who took part, when, and the fingerprints of the
            final files.
          </p>
        </div>
        <Link
          href={selfHref}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-heading hover:bg-blush"
        >
          <ArrowLeft className="size-4" aria-hidden /> Signed document
        </Link>
      </div>
      <CompletedPdfViewer
        src={fileUrl('certificate', true)}
        downloadHref={fileUrl('certificate')}
        allowPrint={view.request.allowPrint}
        title={`${view.request.title} evidence certificate`}
      />
      <section className="rounded-2xl border border-border bg-white p-5 shadow-card">
        <h3 className="font-display text-xl">Integrity references</h3>
        <p className="mt-1 text-sm">
          SHA-256 fingerprints of the completed files. Anyone can compare a copy against these to
          confirm it has not been changed.
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt>Signed document</dt>
          <dd className="break-all font-mono text-xs text-heading">{view.files.signed?.sha256}</dd>
          <dt>Certificate</dt>
          <dd className="break-all font-mono text-xs text-heading">
            {view.files.certificate?.sha256}
          </dd>
        </dl>
      </section>
      <details className="rounded-2xl border border-border bg-white p-5 shadow-card">
        <summary className="cursor-pointer font-display text-xl text-heading">
          Signing events ({view.events.length})
        </summary>
        <ol
          className="mt-3 flex flex-col gap-2 border-l-2 border-primary-surface pl-4 text-sm"
          aria-label="Signing events"
        >
          {view.events.map((e, i) => (
            <li key={i}>
              <p className="font-medium text-heading">{EVENT_LABELS[e.type] ?? e.type}</p>
              <p className="text-xs">
                {at(e.at)} · <span className="font-mono">{e.hash.slice(0, 16)}…</span>
              </p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
