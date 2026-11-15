import type { Metadata } from 'next';
import { CheckCircle2, CircleMinus, Search, ShieldCheck, XCircle } from 'lucide-react';
import { normalizeVerificationRef, verifyReference } from '@st/core';
import { hitRateLimit } from '@st/core/studio/service';
import { db } from '@/lib/db';
import { requestMeta } from '@/lib/session';
import { buttonClass } from '@/components/ui/button';
import { HashCheck } from './hash-check';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verify a Certificate of Completion | Signature Tender',
  description:
    'Look up a Signature Tender Certificate of Completion by its verification reference.',
  robots: { index: false, follow: false },
};

const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});
const when = (d: Date | null) => (d ? dateFmt.format(d) : '—');

const STATUS: Record<string, string> = {
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function Check({
  state,
  title,
  children,
}: {
  state: 'yes' | 'no' | 'na';
  title: string;
  children: React.ReactNode;
}) {
  const Icon = state === 'yes' ? CheckCircle2 : state === 'no' ? XCircle : CircleMinus;
  const tone = state === 'yes' ? 'text-success' : state === 'no' ? 'text-error' : 'text-slate-text';
  return (
    <li className="flex gap-3 py-3">
      <Icon className={`mt-0.5 size-5 shrink-0 ${tone}`} aria-hidden />
      <div>
        <p className="font-semibold text-heading">
          {title}
          <span className="sr-only">
            : {state === 'yes' ? 'yes' : state === 'no' ? 'no' : 'not applicable'}
          </span>
        </p>
        <p className="text-sm">{children}</p>
      </div>
    </li>
  );
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const sp = await searchParams;
  const raw = (Array.isArray(sp.ref) ? sp.ref[0] : sp.ref)?.slice(0, 40) ?? '';
  const ref = raw ? normalizeVerificationRef(raw) : null;
  let limited = false;
  let found: Awaited<ReturnType<typeof verifyReference>> = null;
  if (ref) {
    const { ipAddress } = await requestMeta();
    limited = !(await hitRateLimit(db(), `verify:${ipAddress ?? 'unknown'}`, 60, 3600));
    if (!limited) found = await verifyReference(db(), ref);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Verification</p>
      <h1 className="mt-2 font-display text-4xl text-heading">
        Verify a Certificate of Completion
      </h1>
      <p className="mt-3 max-w-2xl">
        Enter the verification reference printed on the certificate (it looks like{' '}
        <span className="font-mono">STV-XXXX-XXXX</span>). This page shows only whether the record
        exists and its status. It never shows names, email addresses or document contents.
      </p>

      <form
        method="get"
        className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
        role="search"
      >
        <label className="flex-1 text-sm font-medium text-heading">
          Verification reference
          <input
            name="ref"
            defaultValue={raw}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="STV-XXXX-XXXX"
            className="mt-1.5 block w-full rounded-lg border border-border bg-white px-3 py-2.5 font-mono uppercase"
          />
        </label>
        <button type="submit" className={buttonClass('primary', 'md', 'min-h-11')}>
          <Search className="size-4" aria-hidden /> Look up
        </button>
      </form>

      <div className="mt-8 flex flex-col gap-6" aria-live="polite">
        {raw && !ref ? (
          <p className="rounded-xl bg-error-bg px-4 py-3 text-sm text-error" role="alert">
            That does not look like a verification reference. Check it against the certificate.
          </p>
        ) : null}
        {limited ? (
          <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning" role="alert">
            Too many lookups from this connection. Try again in an hour.
          </p>
        ) : null}
        {ref && !limited && !found ? (
          <div className="rounded-2xl border border-border bg-white p-5 shadow-card">
            <ul className="divide-y divide-border">
              <Check state="no" title="Reference not found">
                No Certificate of Completion has the reference{' '}
                <span className="font-mono">{ref}</span>. Check for typing mistakes, or ask the
                person who sent you the document.
              </Check>
            </ul>
          </div>
        ) : null}
        {found ? (
          <>
            <section
              className="rounded-2xl border border-border bg-white p-5 shadow-card"
              aria-labelledby="result-heading"
            >
              <h2
                id="result-heading"
                className="flex items-center gap-2 font-display text-xl text-heading"
              >
                <ShieldCheck className="size-5 text-gold" aria-hidden /> {found.verificationRef}
              </h2>
              {found.isTest ? (
                <p className="mt-2 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
                  Test request: created in a test environment, not for real agreements.
                </p>
              ) : null}
              <ul className="mt-2 divide-y divide-border">
                <Check state="yes" title="Reference found">
                  Signature Tender has a signing record with this reference. Status:{' '}
                  <strong>{STATUS[found.status] ?? found.status}</strong>.
                </Check>
                <Check state="na" title="Document hash not checked yet">
                  Knowing the reference does not prove that a particular PDF is the signed one. Use
                  “Check a copy” below to compare a file with the stored files.
                </Check>
                <Check state="na" title="No certificate-based digital signature">
                  Signature Tender records electronic signatures with an evidence log and SHA-256
                  fingerprints. Documents are not sealed with a PKI digital signature, so there is
                  no cryptographic signature to validate.
                </Check>
                <Check state="na" title="Identity not independently verified">
                  Signers showed they controlled their email address (and entered a one-time code
                  where the sender required one). Signature Tender did not check identity documents.
                </Check>
              </ul>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
                {(
                  [
                    ['Certificate ID', found.certificateNumber ?? '—'],
                    ['Certificate issued', when(found.certificateIssuedAt)],
                    ['Signing completed', when(found.completedAt)],
                    ['Participants who acted', String(found.signerCount)],
                    [
                      'Pages',
                      found.agreementPages
                        ? `${found.agreementPages} agreement + ${found.certificatePages ?? 0} certificate`
                        : '—',
                    ],
                    [
                      'Stored files',
                      found.filesAvailable
                        ? 'Available to authorised people'
                        : 'Deleted after the retention period; fingerprints kept',
                    ],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-text">{k}</dt>
                    <dd className="font-medium text-heading">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {found.status === 'completed' ? (
              <HashCheck verificationRef={found.verificationRef} />
            ) : null}
            <p className="text-sm">
              Party to this agreement? Open it from your email link or{' '}
              <a href="/retrieve" className="font-semibold text-primary underline">
                retrieve your documents
              </a>{' '}
              to see the full certificate and evidence.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
