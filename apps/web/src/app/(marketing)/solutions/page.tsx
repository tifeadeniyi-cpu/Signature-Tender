import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { JsonLd } from '@/components/json-ld';
import { LandingCta, LandingHero } from '@/components/landing/landing';
import { SOLUTIONS, SOLUTION_LINKS } from '@/lib/marketing-pages';
import { getPriceVars } from '@/lib/price-vars';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata = pageMetadata({
  title: 'E-Signature Solutions for Every Use | Signature Tender',
  description:
    'Electronic signatures for small businesses, real estate, HR, freelancers and anyone who needs to sign a PDF online. Pay per document, no subscription.',
  path: '/solutions',
});

export default async function SolutionsHub() {
  const v = await getPriceVars();
  const trail: [string, string][] = [
    ['Home', '/'],
    ['Solutions', '/solutions'],
  ];
  const priceNote = `${v.price} per document. No subscription. Recipients sign free.`;
  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', ...breadcrumbJsonLd(trail) }} />
      <LandingHero
        trail={trail}
        eyebrow="SOLUTIONS"
        title="Electronic Signatures for the Way You Work"
        intro="Whether you sign one PDF a year or send contracts every week, Signature Tender keeps e-signing simple and lets you pay only when you send."
        priceNote={priceNote}
      />
      <section aria-labelledby="uses" className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 id="uses" className="font-display text-3xl">
          Find your use
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/solutions/${s.slug}`}
                className="flex h-full flex-col rounded-2xl border border-border bg-white p-6 shadow-card hover:border-primary"
              >
                <span className="font-display text-xl text-heading">{SOLUTION_LINKS[s.slug]}</span>
                <span className="mt-2 flex-1 text-sm">{s.metaDescription}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Learn more <ArrowRight className="size-4" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <LandingCta priceNote={priceNote} />
    </>
  );
}
