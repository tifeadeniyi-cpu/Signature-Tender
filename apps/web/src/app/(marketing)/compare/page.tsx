import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { JsonLd } from '@/components/json-ld';
import { LandingCta, LandingHero } from '@/components/landing/landing';
import { COMPETITORS } from '@/lib/marketing-pages';
import { getPriceVars } from '@/lib/price-vars';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata = pageMetadata({
  title: 'Compare E-Signature Tools: Docusign, Adobe Sign Alternatives | Signature Tender',
  description:
    'Compare Signature Tender with Docusign, Adobe Acrobat Sign and Dropbox Sign. See pricing models, features and which e-signature tool fits how often you send.',
  path: '/compare',
});

export default async function CompareHub() {
  const v = await getPriceVars();
  const trail: [string, string][] = [
    ['Home', '/'],
    ['Compare', '/compare'],
  ];
  const priceNote = `${v.price} per document. No subscription. Recipients sign free.`;
  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', ...breadcrumbJsonLd(trail) }} />
      <LandingHero
        trail={trail}
        eyebrow="COMPARE E-SIGNATURE TOOLS"
        title="How Signature Tender Compares to Other E-Signature Platforms"
        intro="The big e-signature platforms are built around subscriptions for teams that send every day. Signature Tender is built for people and small teams who send when they need to, and want to pay only then. Here is an honest look at where each one fits."
        priceNote={priceNote}
      />
      <section aria-labelledby="alts" className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 id="alts" className="font-display text-3xl">
          Alternatives and comparisons
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {COMPETITORS.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/compare/${c.slug}`}
                className="flex h-full flex-col rounded-2xl border border-border bg-white p-6 shadow-card hover:border-primary"
              >
                <span className="font-display text-xl text-heading">{c.short} alternative</span>
                <span className="mt-2 flex-1 text-sm">{c.metaDescription}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Signature Tender vs {c.short} <ArrowRight className="size-4" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <LandingCta priceNote={priceNote} />
      <p className="mx-auto max-w-5xl px-4 pb-10 text-xs sm:px-6">
        Docusign, Adobe Acrobat Sign and Dropbox Sign are trademarks of their respective owners.
        Signature Tender is not affiliated with or endorsed by them.
      </p>
    </>
  );
}
