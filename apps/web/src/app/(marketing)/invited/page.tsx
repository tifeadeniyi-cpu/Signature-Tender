import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, Gift, PenLine, ShieldCheck } from 'lucide-react';
import {
  REJECTION_MESSAGES,
  checkReferralCode,
  getReferralProgram,
  type ReferralRejection,
} from '@st/core';
import { buttonClass } from '@/components/ui/button';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { readReferralCookie } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "You've Been Invited to Signature Tender",
  description: 'Create your Signature Tender account and receive a free document-signing credit.',
  robots: { index: false, follow: false },
};

/** The invite page a referral link lands on. Works signed out; shows nothing about the referrer. */
export default async function InvitedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const [program, cookie, session] = await Promise.all([
    getReferralProgram(db()),
    readReferralCookie(),
    getSession(),
  ]);
  const check = cookie ? await checkReferralCode(db(), cookie.code) : null;
  const valid = Boolean(check?.ok) && program.live;
  const problem: string | null =
    status === 'busy'
      ? 'Too many attempts from your network. Please try again later.'
      : status && status in REJECTION_MESSAGES
        ? REJECTION_MESSAGES[status as ReferralRejection]
        : !valid
          ? REJECTION_MESSAGES[
              (check && !check.ok ? check.reason : 'program_off') as ReferralRejection
            ]
          : null;
  const credits = program.referredCredits;
  const creditLabel = `${credits} Free Signing Credit${credits === 1 ? '' : 's'}`;

  return (
    <section className="bg-ivory">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:py-20">
        <div className="overflow-hidden rounded-3xl bg-[linear-gradient(160deg,#0D1B33_0%,#172D4D_60%,#0A1629_100%)] p-8 text-white shadow-card sm:p-12">
          <div className="flex flex-col gap-10 lg:flex-row lg:items-center">
            <div className="flex-1">
              <p className="inline-flex items-center gap-2 rounded-full border border-[#D8AF68]/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#F3DEB4]">
                <Gift className="size-3.5" aria-hidden /> {program.name}
              </p>
              <h1 className="mt-5 font-display text-4xl leading-tight sm:text-5xl">
                You&rsquo;ve Been Invited to Signature Tender!
              </h1>
              <p className="mt-4 max-w-xl text-lg text-[#CBD5E1]">
                {valid
                  ? program.settings.landingMessage
                  : 'Fast, secure electronic signatures with an audit trail on every document.'}
              </p>
              {problem && !session ? (
                <p
                  role="status"
                  className="mt-5 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-[#F3DEB4]"
                >
                  {problem}
                </p>
              ) : null}
              <div className="mt-8 flex flex-wrap gap-3">
                {session ? (
                  <>
                    <p role="status" className="w-full text-sm text-[#F3DEB4]">
                      {REJECTION_MESSAGES.existing_customer}
                    </p>
                    <Link href="/app" className={buttonClass('gold', 'lg')}>
                      Go to your dashboard
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/sign-up" className={buttonClass('gold', 'lg')}>
                      Create Free Account
                    </Link>
                    <Link
                      href="/sign-in"
                      className="inline-flex min-h-12 items-center rounded-xl px-4 font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      Already Have an Account? Sign In
                    </Link>
                  </>
                )}
              </div>
            </div>
            {valid ? (
              <div className="rounded-2xl border border-[#D8AF68]/40 bg-white/[0.04] p-6 text-center lg:w-72">
                <p className="font-display text-6xl text-[#D8AF68]">{credits}</p>
                <p className="mt-2 font-semibold">You Get {creditLabel}</p>
                <p className="mt-2 text-sm text-[#CBD5E1]">
                  Added to your account after you verify your email and create your workspace.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: PenLine,
              title: 'One credit, one document',
              body: 'A credit sends one standard document for signature, with all its signers, an audit trail and a Certificate of Completion.',
            },
            {
              icon: ShieldCheck,
              title: 'Signers never pay',
              body: 'The people you send documents to sign for free, without an account.',
            },
            {
              icon: CheckCircle2,
              title: 'No subscription needed',
              body: 'Pay only when you send. Your free credit covers your first document.',
            },
          ].map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border border-border bg-white p-5 shadow-card"
            >
              <c.icon className="size-6 text-[#D8AF68]" aria-hidden />
              <h2 className="mt-3 font-semibold text-heading">{c.title}</h2>
              <p className="mt-1 text-sm">{c.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm">
          Referral credits have no cash value.{' '}
          <Link
            href={program.settings.termsUrl}
            className="font-semibold text-primary underline underline-offset-2"
          >
            Program terms
          </Link>
        </p>
      </div>
    </section>
  );
}
