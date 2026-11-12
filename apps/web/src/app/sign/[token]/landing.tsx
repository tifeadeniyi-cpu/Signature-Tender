import {
  ShieldCheck,
  PenLine,
  FileText,
  FileSearch,
  CircleCheck,
  CalendarDays,
  UsersRound,
  Files,
  Clock,
  ArrowRight,
} from 'lucide-react';
import type { RecipientRole } from '@st/core';
import { Alert } from '@/components/ui/feedback';
import { env } from '@/lib/env';
import { LandingActions } from './landing-actions';

/** Wording that changes with the recipient's assigned role. */
export function roleCopy(role: RecipientRole) {
  switch (role) {
    case 'approver':
      return {
        label: 'Approver',
        verb: 'approval',
        cta: 'Review & Approve',
        heading: 'Review & Approve Your Document',
        step2: { title: 'Approve', body: 'Record your approval using Signature Tender.' },
        step3: 'Submit your approval and receive confirmation.',
      };
    case 'reviewer':
      return {
        label: 'Reviewer',
        verb: 'review',
        cta: 'Review Document',
        heading: 'Review Your Document',
        step2: { title: 'Confirm', body: 'Complete any fields assigned to you.' },
        step3: 'Submit your review and receive confirmation.',
      };
    case 'cc':
      return {
        label: 'CC Recipient',
        verb: 'attention',
        cta: 'Review Document',
        heading: 'A Document Was Shared With You',
        step2: { title: 'Follow', body: 'Signers complete the document.' },
        step3: 'Receive a copy when everyone has finished.',
      };
    case 'viewer':
      return {
        label: 'Viewer',
        verb: 'attention',
        cta: 'Review Document',
        heading: 'A Document Was Shared With You',
        step2: { title: 'Follow', body: 'Signers complete the document.' },
        step3: 'Receive a copy when everyone has finished.',
      };
    default:
      return {
        label: 'Signer',
        verb: 'electronic signature',
        cta: 'Review & Sign Document',
        heading: 'Review & Sign Your Document',
        step2: { title: 'Sign', body: 'Add your signature using Signature Tender.' },
        step3: 'Complete your signing and receive confirmation.',
      };
  }
}

export type LandingView = {
  title: string;
  senderName: string;
  senderEmail: string;
  workspaceName: string;
  sentAt: Date | null;
  expiresAt: Date | null;
  pageCount: number | null;
  emailMessage: string | null;
  isTest: boolean;
  recipient: { name: string; email: string; role: RecipientRole; authMethod: string };
};

/** The page a recipient lands on from the invitation email, before any session exists. */
export function Landing({ token, view }: { token: string; view: LandingView }) {
  const copy = roleCopy(view.recipient.role);
  // Same zone the invitation email uses, so the dates match what the recipient just read.
  const dateTime = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: env().EMAIL_TIMEZONE,
    timeZoneName: 'short',
  });
  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (view.sentAt)
    facts.push({ icon: <CalendarDays />, label: 'Sent', value: dateTime.format(view.sentAt) });
  facts.push({ icon: <UsersRound />, label: 'Your role', value: copy.label });
  if (view.pageCount)
    facts.push({ icon: <Files />, label: 'Pages', value: String(view.pageCount) });
  if (view.expiresAt)
    facts.push({ icon: <Clock />, label: 'Expires', value: dateTime.format(view.expiresAt) });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      {view.isTest ? (
        <Alert tone="warning" className="mt-6">
          Test request from a non-production environment. Not for real agreements.
        </Alert>
      ) : null}

      <section className="grid items-start gap-10 py-10 lg:grid-cols-[1fr_minmax(0,30rem)] lg:gap-14 lg:py-14">
        <div>
          <span className="inline-block rounded-full bg-soft-gold/70 px-4 py-1.5 text-sm font-semibold text-primary">
            You&apos;ve Been Invited to Sign
          </span>
          <h1 className="mt-5 font-display text-4xl leading-[1.08] text-primary sm:text-5xl lg:text-6xl">
            {copy.heading}
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-text">
            {view.senderName} has requested your {copy.verb} on a document using Signature Tender.
          </p>
          <ul className="mt-8 flex flex-col gap-5">
            <Highlight icon={<ShieldCheck />} title="Secure & Private">
              Your document is accessed through a protected signing session.
            </Highlight>
            <Highlight icon={<PenLine />} title="Simple & Fast">
              Review, sign, and complete your document online.
            </Highlight>
            <Highlight icon={<FileText />} title="Electronic Signing">
              Complete the requested electronic signature process.
            </Highlight>
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-white p-6 shadow-[0_12px_40px_-16px_rgba(13,27,51,0.22)] sm:p-8">
          <div className="flex items-start gap-4">
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-blush text-primary"
              aria-hidden
            >
              <FileText className="size-7" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-2xl leading-tight break-words text-primary sm:text-3xl">
                {view.title}
              </h2>
              <p className="mt-1 text-sm break-words">
                From: <span className="font-semibold text-heading">{view.senderName}</span> (
                {view.senderEmail})
              </p>
              {view.workspaceName ? <p className="text-xs">{view.workspaceName}</p> : null}
            </div>
          </div>
          <dl className="mt-5 flex flex-col gap-3 border-t border-border pt-5 text-sm">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <span className="text-primary [&>svg]:size-5" aria-hidden>
                  {f.icon}
                </span>
                <dt className="font-semibold text-heading">{f.label}:</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {view.emailMessage ? (
            <blockquote className="mt-5 rounded-lg bg-ivory p-3 text-sm whitespace-pre-wrap">
              {view.emailMessage}
            </blockquote>
          ) : null}
          <LandingActions
            token={token}
            cta={copy.cta}
            codeRequired={view.recipient.authMethod === 'email_code'}
            recipientEmail={view.recipient.email}
          />
          <p className="mt-4 text-center text-xs">
            Not {view.recipient.name}? Close this page and let the sender know.
          </p>
        </div>
      </section>

      <HowItWorks step2={copy.step2} step3={copy.step3} />

      <section className="mt-12 flex flex-col gap-4 rounded-2xl bg-blush/60 px-6 py-6 sm:flex-row sm:items-center sm:gap-8 sm:px-10">
        <div className="flex shrink-0 items-center gap-3">
          <ShieldCheck className="size-8 text-primary" aria-hidden />
          <h2 className="font-display text-2xl text-primary">About Signature Tender</h2>
        </div>
        <span className="hidden h-12 w-px bg-primary/30 sm:block" aria-hidden />
        <p className="text-sm leading-relaxed">
          Signature Tender is an electronic signature platform that makes it easy to send, sign, and
          manage documents. <strong className="text-primary">Send. Sign. Pay Once.</strong>{' '}
          <a
            href="/product"
            target="_blank"
            rel="noopener"
            className="font-semibold text-primary underline underline-offset-4"
          >
            Learn more
          </a>
        </p>
      </section>
    </div>
  );
}

function Highlight({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-4">
      <span className="mt-0.5 text-primary [&>svg]:size-8 [&>svg]:stroke-[1.5]" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="font-semibold text-primary">{title}</p>
        <p className="text-sm">{children}</p>
      </div>
    </li>
  );
}

function HowItWorks({ step2, step3 }: { step2: { title: string; body: string }; step3: string }) {
  const steps = [
    { icon: <FileSearch />, title: 'Review', body: 'Read the document and confirm the details.' },
    { icon: <PenLine />, title: step2.title, body: step2.body },
    { icon: <CircleCheck />, title: 'Submit', body: step3 },
  ];
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-6">
      <div className="flex items-center justify-center gap-6">
        <span className="hidden h-px w-24 bg-primary/50 sm:block" aria-hidden />
        <h2 id="how-heading" className="font-display text-3xl text-primary sm:text-4xl">
          How It Works
        </h2>
        <span className="hidden h-px w-24 bg-primary/50 sm:block" aria-hidden />
      </div>
      <ol className="mt-10 flex flex-col items-stretch gap-8 md:flex-row md:items-center md:gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="contents">
            <div className="relative flex-1 rounded-2xl border border-border bg-white/70 px-6 pb-6 pt-10 text-center">
              <span className="absolute -left-2 -top-4 flex size-11 items-center justify-center rounded-full bg-primary font-display text-xl text-white">
                {i + 1}
              </span>
              <span
                className="mx-auto block w-fit text-primary [&>svg]:size-12 [&>svg]:stroke-[1.4]"
                aria-hidden
              >
                {s.icon}
              </span>
              <h3 className="mt-3 font-display text-2xl text-primary">{s.title}</h3>
              <p className="mt-1 text-sm">{s.body}</p>
            </div>
            {i < steps.length - 1 ? (
              <ArrowRight className="hidden size-7 shrink-0 text-primary md:block" aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
