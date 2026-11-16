import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { JsonLd } from '@/components/json-ld';
import { LandingCta, LandingFaq, LandingHero, RelatedLinks } from '@/components/landing/landing';
import { COMPETITORS, SOLUTION_LINKS, competitorBySlug, fill } from '@/lib/marketing-pages';
import { getPriceVars } from '@/lib/price-vars';
import { breadcrumbJsonLd, faqJsonLd, pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const REVIEWED = 'November 2026';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const c = competitorBySlug((await params).slug);
  if (!c) return {};
  return pageMetadata({
    title: c.metaTitle,
    description: c.metaDescription,
    path: `/compare/${c.slug}`,
  });
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const c = competitorBySlug((await params).slug);
  if (!c) notFound();
  const v = await getPriceVars();
  const f = (t: string) => fill(t, v);
  const faq = c.faq.map((x) => ({ q: f(x.q), a: f(x.a) }));
  const trail: [string, string][] = [
    ['Home', '/'],
    ['Compare', '/compare'],
    [`${c.short} alternative`, `/compare/${c.slug}`],
  ];
  const priceNote = `${v.price} per document. No subscription. Recipients sign free.`;
  const others = COMPETITORS.filter((o) => o.slug !== c.slug);

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [breadcrumbJsonLd(trail), faqJsonLd(faq)],
        }}
      />
      <LandingHero
        trail={trail}
        eyebrow={`SIGNATURE TENDER VS ${c.short.toUpperCase()}`}
        title={c.h1}
        intro={f(c.intro)}
        priceNote={priceNote}
      />

      <section aria-labelledby="fit" className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 id="fit" className="font-display text-3xl">
          Which one fits you?
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border-2 border-primary bg-white p-6 shadow-card">
            <h3 className="font-semibold text-heading">Choose Signature Tender if</h3>
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {c.weFit.map((x) => (
                <li key={x} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  {f(x)}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-white p-6">
            <h3 className="font-semibold text-heading">Choose {c.short} if</h3>
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              {c.theyFit.map((x) => (
                <li key={x} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-slate-text" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="table" className="mx-auto max-w-5xl px-4 pb-14 sm:px-6">
        <h2 id="table" className="font-display text-3xl">
          Signature Tender vs {c.short}: feature comparison
        </h2>
        <div
          className="mt-6 overflow-x-auto rounded-2xl border border-border bg-white"
          tabIndex={0}
        >
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">
              Feature comparison of Signature Tender and {c.name}
            </caption>
            <thead className="bg-ivory text-heading">
              <tr>
                <th scope="col" className="p-4 font-semibold">
                  Feature
                </th>
                <th scope="col" className="p-4 font-semibold">
                  Signature Tender
                </th>
                <th scope="col" className="p-4 font-semibold">
                  {c.name}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {c.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="p-4 font-semibold text-heading">
                    {r.label}
                  </th>
                  <td className="p-4">{f(r.us)}</td>
                  <td className="p-4">{r.them}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs">
          Based on public information reviewed in {REVIEWED}. Plans and features change, so check{' '}
          <a
            href={c.pricingUrl}
            rel="nofollow noopener noreferrer"
            target="_blank"
            className="underline"
          >
            {c.short}’s current plans
          </a>{' '}
          and our{' '}
          <Link href="/pricing" className="underline">
            pricing
          </Link>{' '}
          before you decide.
        </p>
      </section>

      <LandingFaq id="compare-faq" items={faq} />
      <RelatedLinks
        title="More comparisons and guides"
        links={[
          ...others.map((o): [string, string] => [`${o.short} alternative`, `/compare/${o.slug}`]),
          [
            SOLUTION_LINKS['e-signature-without-subscription']!,
            '/solutions/e-signature-without-subscription',
          ],
          [SOLUTION_LINKS['sign-pdf-online']!, '/solutions/sign-pdf-online'],
        ]}
      />
      <LandingCta priceNote={priceNote} />
      <p className="mx-auto max-w-5xl px-4 pb-10 text-xs sm:px-6">
        {c.name} is a trademark of {c.owner.replace(/\.$/, '')}. Signature Tender is not affiliated
        with or endorsed by {c.short}. Product names are used only to identify the products
        compared.
      </p>
    </>
  );
}
