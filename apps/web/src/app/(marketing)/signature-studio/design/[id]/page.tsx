import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CheckCircle2, FileSignature, Library } from 'lucide-react';
import { formatMoney } from '@st/core';
import { getPurchasedDesign } from '@st/core/studio/server';
import { buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { designSvg, studioSettings } from '@/lib/studio';
import { DownloadButtons } from '../../downloads';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your signature', robots: { index: false } };

/** The download window for a purchased design. Access is checked against the entitlement. */
export default async function PurchasedDesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const session = await getSession();
  if (!session?.user.emailVerified) redirect('/sign-in');
  const { id } = await params;
  const settings = await studioSettings();
  const info = await getPurchasedDesign(db(), session.user.id, id, settings);
  if (!info) notFound();
  if (info.design.status === 'draft') redirect(`/signature-studio/checkout/${id}`);
  const svg = await designSvg(info.snapshot, { width: 720 });
  const fresh = (await searchParams).new === '1';
  return (
    <div className="bg-cream/60">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
          <section aria-labelledby="ready-heading">
            {fresh ? <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-sm font-semibold text-success"><CheckCircle2 className="size-4" aria-hidden /> Payment confirmed</p> : null}
            <h1 id="ready-heading" className="font-display text-3xl text-heading sm:text-4xl">
              Your Custom Signature Is Ready
            </h1>
            <div className="mt-6 rounded-2xl border border-border p-6 shadow-card" style={{ background: 'repeating-conic-gradient(#eef0f3 0% 25%, #ffffff 0% 50%) 50% / 20px 20px' }}>
              <div role="img" aria-label="Your purchased signature" className="[&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-h-60 [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
            <p className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-success">
              <Library className="size-4" aria-hidden /> Saved to Your Signature Library
            </p>
          </section>
          <aside aria-label="Downloads" className="h-fit rounded-2xl border border-border bg-white p-6 shadow-card">
            {info.entitlement && info.retained ? (
              <DownloadButtons designId={id} formats={info.formats} />
            ) : (
              <Alert tone="warning">
                {info.entitlement ? 'The download period for this design has ended.' : 'Downloads for this design are no longer available because the payment was refunded or disputed.'}
              </Alert>
            )}
            <p className="mt-4 text-xs text-slate-text">
              PNG and SVG have transparent backgrounds. {info.snapshot.upload ? 'SVG is not offered for uploaded images.' : 'The SVG is true vector: letters are converted to outlines.'}
            </p>
            <div className="mt-6 border-t border-border pt-4">
              <Link href="/app/documents/new" className={buttonClass('secondary', 'md', 'w-full')}>
                <FileSignature className="size-4" aria-hidden /> Use This Signature to Sign a Document
              </Link>
              <p className="mt-2 text-xs text-slate-text">When you sign on Signature Tender while signed in, choose it under My Signatures in the signing window. No extra fee.</p>
            </div>
            {info.purchase ? (
              <p className="mt-4 text-xs text-slate-text">
                Paid {formatMoney(info.purchase.amountCents, info.purchase.currency)}
                {info.purchase.purchasedAt ? ` on ${info.purchase.purchasedAt.toLocaleDateString('en-US', { dateStyle: 'medium' })}` : ''}.{' '}
                <Link href={`/signature-studio/receipt/${info.purchase.id}`} className="font-semibold text-primary hover:underline">
                  View receipt
                </Link>
              </p>
            ) : null}
          </aside>
        </div>
        {settings.crossSell ? (
          <section aria-labelledby="work-heading" className="mt-12 rounded-2xl bg-primary p-8 text-white">
            <h2 id="work-heading" className="font-display text-2xl text-white">
              Put Your Signature to Work
            </h2>
            <p className="mt-2 max-w-2xl text-white/85">Now that you&apos;ve created your signature, use Signature Tender to sign and send documents online whenever you need.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/app/documents/new" className={buttonClass('gold', 'md')}>
                Sign a Document
              </Link>
              <Link href="/app/documents/new" className={buttonClass('inverse', 'md')}>
                Send for Signature
              </Link>
              <Link href="/product" className={buttonClass('inverse-ghost', 'md')}>
                Explore Signature Tender
              </Link>
            </div>
          </section>
        ) : null}
        <p className="mt-6 text-center text-xs text-slate-text">
          A signature design is artwork. It does not verify identity, and having the file does not sign or execute a document. Only sign documents you are entitled to sign.
        </p>
      </div>
    </div>
  );
}
