import Link from 'next/link';
import { Check } from 'lucide-react';
import { getPricing, formatMoney } from '@st/core';
import { db } from '@/lib/db';
import { PricingStrip } from '@/components/pricing-strip';
import { JsonLd } from '@/components/json-ld';
import { absoluteUrl, faqJsonLd, pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const TITLE = 'E-Signature Pricing: Pay Per Document, No Subscription | Signature Tender';
const DESCRIPTION =
  'Simple electronic signature pricing. Pay per signing request, save with prepaid credit packs, or choose an optional monthly plan. Recipients always sign free.';

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: '/pricing' });

export default async function PricingPage() {
  const { plans, prices } = await getPricing(db());
  const single = prices.find((p) => p.code === 'single_request');
  const singleLabel = single ? formatMoney(single.amountCents, single.currency) : null;
  const faq = [
    {
      q: 'Do I need a subscription to send documents for signature?',
      a: `No. Pay for each signing request${singleLabel ? ` (${singleLabel})` : ''} or buy a credit pack. Monthly plans are optional, for people who send often.`,
    },
    {
      q: 'What does one signing request include?',
      a: 'One document, up to five signers, email invitations and reminders, and the completed PDF with its audit certificate.',
    },
    {
      q: 'Do recipients pay to sign?',
      a: 'No. Recipients sign from a secure email link without an account and never pay.',
    },
    {
      q: 'Do prepaid credits expire?',
      a: 'Prepaid credits do not expire at launch, subject to final terms.',
    },
  ];
  const offers = [
    ...prices.map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: (p.amountCents / 100).toFixed(2),
      priceCurrency: p.currency.toUpperCase(),
      description: p.credits === 1 ? 'One signing request' : `${p.credits} signing requests`,
    })),
    ...plans
      .filter((p) => !p.isCustom && p.monthlyPriceCents !== null)
      .map((p) => ({
        '@type': 'Offer',
        name: p.name,
        price: (p.monthlyPriceCents! / 100).toFixed(2),
        priceCurrency: p.currency.toUpperCase(),
        description: p.description,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: (p.monthlyPriceCents! / 100).toFixed(2),
          priceCurrency: p.currency.toUpperCase(),
          unitCode: 'MON',
        },
      })),
  ];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Signature Tender',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web browser',
        url: absoluteUrl('/pricing'),
        ...(offers.length ? { offers } : {}),
      },
      faqJsonLd(faq),
    ],
  };
  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <JsonLd data={jsonLd} />
      <h1 className="text-center font-display text-4xl">Electronic Signature Pricing</h1>
      <p className="mx-auto mt-3 max-w-2xl text-center">
        One signing request includes one document, up to five signers, email invitations and
        reminders, and the completed document with its audit certificate. Recipients never pay to
        sign.
      </p>

      <section className="mt-12" aria-labelledby="payg">
        <h2 id="payg" className="mb-4 font-display text-2xl">
          Pay as you go
        </h2>
        <PricingStrip prices={prices} />
        <p className="mt-3 text-sm">
          Prepaid credits do not expire at launch, subject to final terms.
        </p>
      </section>

      <section className="mt-14" aria-labelledby="plans">
        <h2 id="plans" className="mb-4 font-display text-2xl">
          Monthly plans for frequent senders
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {plans.map((p) => (
            <li
              key={p.code}
              className="flex flex-col rounded-2xl border border-border bg-white p-5 shadow-card"
            >
              <h3 className="font-display text-xl">{p.name}</h3>
              <p className="mt-2 text-2xl font-semibold text-heading">
                {p.isCustom || p.monthlyPriceCents === null
                  ? 'Custom'
                  : `${formatMoney(p.monthlyPriceCents, p.currency)}`}
                {!p.isCustom && p.monthlyPriceCents !== null ? (
                  <span className="text-sm font-normal"> / month</span>
                ) : null}
              </p>
              <p className="mt-2 text-sm">{p.description}</p>
              <ul className="mt-4 flex flex-col gap-2 text-sm">
                <li className="flex gap-2">
                  <Check className="size-4 shrink-0 text-success" aria-hidden />
                  {p.includedRequests
                    ? `${p.includedRequests} requests per month`
                    : p.isCustom
                      ? 'Configurable volume'
                      : 'No monthly commitment'}
                </li>
                <li className="flex gap-2">
                  <Check className="size-4 shrink-0 text-success" aria-hidden />
                  {p.overagePriceCents !== null
                    ? `${formatMoney(p.overagePriceCents, p.currency)} per additional request`
                    : 'Negotiated rates'}
                </li>
              </ul>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm">
          Checkout is not open yet. Prices are shown in USD and may change before launch. Applicable
          taxes are calculated at checkout.
        </p>
      </section>

      <section className="mt-14" aria-labelledby="pricing-faq">
        <h2 id="pricing-faq" className="mb-6 font-display text-2xl">
          Pricing questions
        </h2>
        <dl className="grid gap-6 sm:grid-cols-2">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold text-heading">{f.q}</dt>
              <dd className="mt-1 text-sm">{f.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-sm">
          Need a custom signature too?{' '}
          <Link href="/signature-studio" className="font-semibold text-primary hover:underline">
            Design one in Signature Studio
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
