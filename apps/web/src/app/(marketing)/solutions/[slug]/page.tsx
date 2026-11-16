import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/json-ld';
import { LandingCta, LandingFaq, LandingHero, RelatedLinks } from '@/components/landing/landing';
import { SOLUTION_LINKS, fill, solutionBySlug } from '@/lib/marketing-pages';
import { getPriceVars } from '@/lib/price-vars';
import { breadcrumbJsonLd, faqJsonLd, pageMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const s = solutionBySlug((await params).slug);
  if (!s) return {};
  return pageMetadata({
    title: s.metaTitle,
    description: s.metaDescription,
    path: `/solutions/${s.slug}`,
  });
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const s = solutionBySlug((await params).slug);
  if (!s) notFound();
  const v = await getPriceVars();
  const f = (t: string) => fill(t, v);
  const faq = s.faq.map((x) => ({ q: f(x.q), a: f(x.a) }));
  const trail: [string, string][] = [
    ['Home', '/'],
    ['Solutions', '/solutions'],
    [SOLUTION_LINKS[s.slug] ?? s.eyebrow, `/solutions/${s.slug}`],
  ];
  const priceNote = `${v.price} per document. No subscription. Recipients sign free.`;
  const howId = 'solution-how';

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            breadcrumbJsonLd(trail),
            {
              '@type': 'HowTo',
              name: `How to ${s.slug === 'sign-pdf-online' ? 'sign a PDF online' : 'send a document for e-signature'} with Signature Tender`,
              step: s.steps.map(([name, text], i) => ({
                '@type': 'HowToStep',
                position: i + 1,
                name,
                text: f(text),
              })),
            },
            faqJsonLd(faq),
          ],
        }}
      />
      <LandingHero
        trail={trail}
        eyebrow={s.eyebrow}
        title={s.h1}
        intro={f(s.intro)}
        priceNote={priceNote}
      />

      <section aria-label="Benefits" className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2">
          {s.points.map((p) => (
            <li key={p.title} className="rounded-2xl border border-border bg-white p-6 shadow-card">
              <h2 className="font-semibold text-heading">{p.title}</h2>
              <p className="mt-2 text-sm">{f(p.body)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={howId} className="bg-blush/50">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
          <h2 id={howId} className="font-display text-3xl">
            How it works
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {s.steps.map(([t, d], i) => (
              <li key={t} className="rounded-2xl border border-border bg-white p-5">
                <span
                  className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-gold"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <p className="mt-3 font-semibold text-heading">{t}</p>
                <p className="mt-1 text-sm">{f(d)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <LandingFaq id="solution-faq" items={faq} />
      <RelatedLinks
        title="Related guides"
        links={[
          ...s.related.map((r): [string, string] => [SOLUTION_LINKS[r]!, `/solutions/${r}`]),
          ['Docusign alternative', '/compare/docusign-alternative'],
          ['Adobe Acrobat Sign alternative', '/compare/adobe-sign-alternative'],
        ]}
      />
      <LandingCta priceNote={priceNote} />
    </>
  );
}
