import Link from 'next/link';
import { Zap, ShieldCheck, Layers, Upload, PenLine, Send, CloudUpload } from 'lucide-react';
import { getPricing, formatMoney } from '@st/core';
import { db } from '@/lib/db';
import { ButtonLink } from '@/components/ui/button';
import { PricingStrip } from '@/components/pricing-strip';

export const dynamic = 'force-dynamic';

const FEATURES = [
  { icon: Zap, title: 'Fast & Simple', body: 'Send in minutes' },
  { icon: ShieldCheck, title: 'Secure by design', body: 'Private links and a full audit trail' },
  { icon: Layers, title: 'Flexible Pricing', body: 'Pay per document or buy credits' },
];

const STEPS = [
  { icon: Upload, title: 'Upload', body: 'Add your PDF document.' },
  { icon: PenLine, title: 'Prepare', body: 'Add signers and place signature fields.' },
  { icon: Send, title: 'Send', body: 'Pay once and send for signature in minutes.' },
];

export default async function HomePage() {
  const { prices } = await getPricing(db());
  const single = prices.find((p) => p.code === 'single_request');
  return (
    <>
      <section className="bg-gradient-to-br from-primary via-primary to-primary-hover text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <div>
            <p className="inline-block rounded-full border border-white/40 px-4 py-1 text-xs font-semibold tracking-widest">
              NO SUBSCRIPTION REQUIRED
            </p>
            <h1 className="mt-5 font-display text-4xl leading-tight text-white sm:text-5xl">
              Send Documents for Signature,
              <span className="block text-rose-gold">Pay Only When You Need To.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/85">
              A simple, secure, and affordable way to get contracts, agreements, and important
              documents signed online.
            </p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex items-start gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-rose-gold" aria-hidden />
                  <span>
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-xs text-white/75">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-white p-6 text-center text-heading shadow-card">
            <h2 className="font-display text-2xl">Send a Document for Signature</h2>
            <div className="mt-5 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-rose-gold bg-ivory px-4 py-8">
              <CloudUpload className="size-10 text-primary" aria-hidden />
              <p className="text-sm font-medium">Upload your PDF, add signers, and send.</p>
              <p className="text-xs text-slate-text">
                Document upload opens in the next release. Create your free account now.
              </p>
            </div>
            <ButtonLink href="/sign-up" size="lg" className="mt-5 w-full">
              Get Started
            </ButtonLink>
            {single ? (
              <p className="mt-4 text-sm">
                One-time fee:{' '}
                <strong className="text-primary">
                  {formatMoney(single.amountCents, single.currency)}
                </strong>{' '}
                per document
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-8 px-4 py-16 sm:px-6">
        <h2 className="text-center font-display text-3xl">How It Works</h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li
              key={title}
              className="flex items-start gap-4 rounded-2xl border border-border bg-white p-5 shadow-card"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
                aria-hidden
              >
                {i + 1}
              </span>
              <span>
                <span className="flex items-center gap-2 font-semibold text-heading">
                  <Icon className="size-5 text-primary" aria-hidden /> {title}
                </span>
                <span className="mt-1 block text-sm">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="rounded-2xl border border-border bg-blush/60 p-6 sm:p-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-3xl">Simple, Transparent Pricing</h2>
            <Link href="/pricing" className="text-sm font-semibold text-primary hover:underline">
              See all plans
            </Link>
          </div>
          <PricingStrip prices={prices} />
        </div>
        <p className="mt-8 text-center text-sm">
          Embedded signing for Beam Artist, Jectstack and other apps, through a documented API, is
          in development.
        </p>
      </section>
    </>
  );
}
