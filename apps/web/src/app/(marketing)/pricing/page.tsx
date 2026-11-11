import { Check } from 'lucide-react';
import { getPricing, formatMoney } from '@st/core';
import { db } from '@/lib/db';
import { PricingStrip } from '@/components/pricing-strip';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pricing' };

export default async function PricingPage() {
  const { plans, prices } = await getPricing(db());
  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <h1 className="text-center font-display text-4xl">Pricing</h1>
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
    </div>
  );
}
