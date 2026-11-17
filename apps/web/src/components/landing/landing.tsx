import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Faq } from '@/lib/marketing-pages';
import { ButtonLink } from '@/components/ui/button';

/** Visible breadcrumb trail, matching the BreadcrumbList structured data. */
export function Breadcrumbs({ trail }: { trail: [string, string][] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-white/75">
      <ol className="flex flex-wrap items-center gap-1">
        {trail.map(([name, path], i) => (
          <li key={path} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5" aria-hidden /> : null}
            {i === trail.length - 1 ? (
              <span aria-current="page">{name}</span>
            ) : (
              <Link href={path} className="hover:text-white hover:underline">
                {name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LandingHero({
  trail,
  eyebrow,
  title,
  intro,
  priceNote,
}: {
  trail: [string, string][];
  eyebrow: string;
  title: string;
  intro: string;
  priceNote: string;
}) {
  return (
    <section className="bg-gradient-to-br from-primary via-primary to-primary-hover text-white">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:py-16">
        <Breadcrumbs trail={trail} />
        <p className="mt-6 text-xs font-semibold tracking-[0.18em] text-gold">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-3xl text-lg text-white/85">{intro}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ButtonLink href="/sign-up" size="lg" variant="gold">
            Create a Free Account
          </ButtonLink>
          <ButtonLink href="/pricing" size="lg" variant="inverse-ghost">
            See Pricing
          </ButtonLink>
        </div>
        <p className="mt-4 text-sm text-white/75">{priceNote}</p>
      </div>
    </section>
  );
}

export function LandingFaq({ id, items }: { id: string; items: Faq[] }) {
  return (
    <section aria-labelledby={id} className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <h2 id={id} className="font-display text-3xl">
        Frequently asked questions
      </h2>
      <dl className="mt-8 grid gap-6 sm:grid-cols-2">
        {items.map((f) => (
          <div key={f.q}>
            <dt className="font-semibold text-heading">{f.q}</dt>
            <dd className="mt-1 text-sm">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LandingCta({ priceNote }: { priceNote: string }) {
  return (
    <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-primary p-8 text-white sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-2xl text-white">Send your first document today</h2>
          <p className="mt-2 text-white/80">{priceNote}</p>
        </div>
        <ButtonLink href="/sign-up" size="lg" variant="gold">
          Get Started
        </ButtonLink>
      </div>
    </section>
  );
}

/** Links to related landing pages, for readers and for crawlers. */
export function RelatedLinks({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <nav aria-label={title} className="mx-auto max-w-5xl px-4 pb-14 sm:px-6">
      <h2 className="font-display text-2xl">{title}</h2>
      <ul className="mt-4 flex flex-wrap gap-3">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link
              href={href}
              className="inline-flex rounded-full border border-border bg-white px-4 py-2 text-sm font-semibold text-primary hover:bg-blush"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
