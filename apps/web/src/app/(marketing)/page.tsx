import Link from 'next/link';
import { Zap, ShieldCheck, Layers, Upload, PenLine, Send, CloudUpload } from 'lucide-react';
import { getPricing, formatMoney } from '@st/core';
import { db } from '@/lib/db';
import { ButtonLink } from '@/components/ui/button';
import { PricingStrip } from '@/components/pricing-strip';
import { getStudioSettings } from '@st/core/studio/server';
import { JsonLd } from '@/components/json-ld';
import { absoluteUrl, pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const TITLE = 'Electronic Signatures Without a Subscription | Signature Tender';
const DESCRIPTION =
  'Sign and send PDFs online with Signature Tender. Add signers, place signature fields, track every step and pay per document. No subscription required.';

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: '/' });

/** Who sends with Signature Tender. Plain descriptions of what the product does today. */
const USE_CASES = [
  {
    title: 'Freelancers and consultants',
    body: 'Send proposals, statements of work and service agreements for e-signature, and pay only for the documents you send.',
  },
  {
    title: 'Small businesses',
    body: 'Get contracts, vendor forms and customer agreements signed online, with reusable templates and a shared team workspace.',
  },
  {
    title: 'Landlords and property managers',
    body: 'Collect signatures on leases, renewals and notices from several people, in order or at the same time.',
  },
  {
    title: 'HR and operations teams',
    body: 'Send offer letters, policies and onboarding forms, then download each signed PDF with its evidence certificate.',
  },
];

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
  const [{ prices }, studio] = await Promise.all([getPricing(db()), getStudioSettings(db())]);
  const single = prices.find((p) => p.code === 'single_request');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Signature Tender',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Electronic signature software',
    operatingSystem: 'Web browser',
    url: absoluteUrl('/'),
    description: DESCRIPTION,
    ...(single
      ? {
          offers: {
            '@type': 'Offer',
            price: (single.amountCents / 100).toFixed(2),
            priceCurrency: single.currency.toUpperCase(),
            description: 'One signing request',
            url: absoluteUrl('/pricing'),
          },
        }
      : {}),
  };
  return (
    <>
      <JsonLd data={jsonLd} />
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
              A simple, secure and affordable electronic signature service. Upload a PDF, add
              signers and get contracts, agreements and important documents signed online.
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

      <section aria-labelledby="home-uses" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <h2 id="home-uses" className="text-center font-display text-3xl">
          Online Signatures for Every Kind of Agreement
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center">
          Recipients sign from a secure email link on any phone, tablet or computer, with no account
          and nothing to pay. You get the completed PDF and an audit certificate.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((u) => (
            <li key={u.title} className="rounded-2xl border border-border bg-white p-5 shadow-card">
              <h3 className="font-semibold text-heading">{u.title}</h3>
              <p className="mt-2 text-sm">{u.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-sm">
          <Link href="/product" className="font-semibold text-primary hover:underline">
            Explore all e-signature features
          </Link>
        </p>
      </section>

      <section aria-labelledby="home-studio" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="grid items-center gap-6 overflow-hidden rounded-2xl bg-primary p-6 text-white sm:p-10 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-gold">
              NEW · SIGNATURE STUDIO
            </p>
            <h2 id="home-studio" className="mt-2 font-display text-3xl">
              Create Your Own Handwritten Signature
            </h2>
            <p className="mt-3 max-w-xl text-white/85">
              Design a signature that looks and feels uniquely yours. Preview it free and download
              your finished design for {formatMoney(studio.priceCents, studio.currency)}.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <ButtonLink href="/signature-studio#studio" size="lg" variant="gold">
              Design My Signature
            </ButtonLink>
            <ButtonLink href="/signature-studio#styles" size="lg" variant="inverse-ghost">
              Explore Styles
            </ButtonLink>
          </div>
        </div>
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
