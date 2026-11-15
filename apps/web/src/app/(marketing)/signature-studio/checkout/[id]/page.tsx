import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatMoney } from '@st/core';
import { getDesign, normalizeDesign, styleLabel } from '@st/core/studio/server';
import { Alert } from '@/components/ui/feedback';
import { paymentsAvailable } from '@/lib/billing';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { designSvg, studioSettings } from '@/lib/studio';
import { PayButton } from './pay-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Review and pay', robots: { index: false } };

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await getSession();
  if (!session?.user.emailVerified) redirect(`/sign-in?next=${encodeURIComponent('/signature-studio/continue')}`);
  const { id } = await params;
  const row = await getDesign(db(), { userId: session.user.id }, id);
  if (!row || row.ownerUserId !== session.user.id) notFound();
  if (row.status === 'purchased') redirect(`/signature-studio/design/${id}`);
  const settings = await studioSettings();
  const design = normalizeDesign(row.design);
  const price = formatMoney(settings.priceCents, settings.currency);
  const svg = await designSvg(design, { width: 640 });
  const canPay = settings.purchasesEnabled && (await paymentsAvailable());
  const cancelled = (await searchParams).checkout === 'cancelled';
  return (
    <div className="bg-cream/60">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr_1fr]">
        <section aria-labelledby="review-heading">
          <h1 id="review-heading" className="font-display text-3xl text-heading">
            Review your signature
          </h1>
          <p className="mt-2 text-slate-text">This is exactly what you will download. Your files are made from this design when payment is confirmed.</p>
          <div className="relative mt-6 rounded-2xl border border-border bg-white p-6 shadow-card">
            <div role="img" aria-label="Your signature design" className="[&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-h-56 [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-4xl font-semibold uppercase tracking-[0.5em] text-slate-400/15" style={{ transform: 'rotate(-12deg)' }}>
              Preview
            </span>
          </div>
          <Link href={`/signature-studio?design=${id}#studio`} className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
            Edit design
          </Link>
        </section>
        <aside aria-labelledby="summary-heading" className="h-fit rounded-2xl border border-border bg-white p-6 shadow-card">
          <h2 id="summary-heading" className="font-display text-xl text-heading">
            Order summary
          </h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-text">Design</dt>
              <dd className="text-right font-medium text-heading">{row.displayName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-text">Style</dt>
              <dd className="text-right font-medium text-heading">{styleLabel(design)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-text">{design.kind === 'initials' ? 'Custom initials' : 'Custom signature'}</dt>
              <dd className="font-medium text-heading">{price}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-text">Taxes</dt>
              <dd className="font-medium text-heading">{formatMoney(0, settings.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-3 text-base">
              <dt className="font-semibold text-heading">Total</dt>
              <dd className="font-semibold text-heading">{price}</dd>
            </div>
          </dl>
          <ul className="mt-4 space-y-1 text-xs text-slate-text">
            <li>One-time payment. No subscription.</li>
            <li>Transparent PNG{design.upload ? '' : ', SVG'} and JPEG, with repeat downloads.</li>
            <li>Saved to your signature library.</li>
          </ul>
          <div className="mt-6">
            {cancelled ? (
              <Alert tone="info" className="mb-3">
                Checkout was cancelled. You have not been charged.
              </Alert>
            ) : null}
            {canPay ? (
              <PayButton designId={id} label={`Pay ${price} & Unlock`} />
            ) : (
              <Alert tone="warning">Purchases are not available right now. Your design is saved in your library.</Alert>
            )}
          </div>
          <p className="mt-4 text-xs text-slate-text">
            Payments are processed securely by Stripe. We never see or store your card details. A signature design is artwork: buying it does not verify your identity or sign a
            document.
          </p>
        </aside>
      </div>
    </div>
  );
}
