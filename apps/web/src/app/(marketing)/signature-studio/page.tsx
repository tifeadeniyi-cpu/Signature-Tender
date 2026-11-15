import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Brush,
  Download,
  FileSignature,
  Layers,
  PenTool,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { formatMoney } from '@st/core';
import {
  FAMILY_BY_ID,
  STYLE_FAMILIES,
  emptyDesign,
  getDesign,
  listLibrary,
  newElement,
  normalizeDesign,
  publicStudioSettings,
  type Design,
} from '@st/core/studio/server';
import { StudioEditor, type SavedDesign } from '@/components/studio/editor';
import { Eyebrow, Heading, Section } from '@/components/product/primitives';
import { buttonClass } from '@/components/ui/button';
import { appUrl } from '@/lib/billing';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { designSvg, readGuestHash, studioSettings } from '@/lib/studio';

export const dynamic = 'force-dynamic';

const TITLE = 'Create Your Own Handwritten Signature | Signature Studio';
const DESCRIPTION =
  'Design a custom handwritten signature online. Personalize every letter, curve and flourish, preview it free, and download transparent PNG, SVG and JPEG files for $0.99.';

export function generateMetadata(): Metadata {
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical: appUrl('/signature-studio') },
    openGraph: { type: 'website', url: appUrl('/signature-studio'), title: TITLE, description: DESCRIPTION, siteName: 'Signature Tender' },
  };
}

function heroDesign(): Design {
  const d = emptyDesign();
  const v = FAMILY_BY_ID['luxury-flourish']!.variants[0]!;
  d.pen = v.pen;
  d.text = { ...d.text!, value: 'Jordan Lee', family: 'luxury-flourish', font: v.font, params: { ...d.text!.params, ...v.params, tail: true, capitals: 1.35 } };
  d.elements = [newElement('u-long-sweep', 'hero', { x: 600, y: 300, scale: 0.95 })];
  return normalizeDesign(d);
}

function familySample(id: string): Design {
  const f = FAMILY_BY_ID[id]!;
  const v = f.variants[0]!;
  const d = emptyDesign();
  d.pen = v.pen;
  d.text = { ...d.text!, value: 'Alex Morgan', family: f.id, font: v.font, params: { ...d.text!.params, ...v.params } };
  if (v.underline) d.elements = [newElement(v.underline, 'samp', { x: 600, y: 300, scale: 0.85 })];
  return normalizeDesign(d);
}

const BENEFITS = [
  { icon: PenTool, title: 'Personalized Handwriting', text: 'Start from your own name in 12 signature styles and more than 50 handwriting fonts.' },
  { icon: Wand2, title: 'Advanced Customization', text: 'Adjust slant, spacing, capitals, connections, baseline and proportions letter by letter.' },
  { icon: Brush, title: 'Custom Drawn Flourishes', text: 'Draw your own strokes. Smart Stroke refines them to match your signature.' },
  { icon: Layers, title: 'Transparent Downloads', text: 'High-resolution transparent PNG, true-vector SVG and JPEG files.' },
  { icon: BadgeCheck, title: 'Save & Reuse', text: 'Your purchased signatures stay in your library, ready to download again.' },
  { icon: FileSignature, title: 'Sign Documents Online', text: 'Use your signature to sign documents on Signature Tender.' },
];

export default async function SignatureStudioPage({ searchParams }: { searchParams: Promise<{ design?: string }> }) {
  const settings = await studioSettings();
  if (!settings.enabled) notFound();
  const session = await getSession();
  const userId = session?.user.emailVerified ? session.user.id : null;
  const price = formatMoney(settings.priceCents, settings.currency);

  const { design: designId } = await searchParams;
  let resume: { id: string | null; design: Design } | null = null;
  if (designId) {
    const guestHash = userId ? null : await readGuestHash();
    if (userId || guestHash) {
      const row = await getDesign(db(), userId ? { userId } : { guestHash: guestHash! }, designId);
      if (row) resume = { id: row.status === 'draft' ? row.id : null, design: normalizeDesign(row.design) };
    }
  }
  const saved: SavedDesign[] = userId
    ? (await listLibrary(db(), userId)).slice(0, 30).map((d) => ({ id: d.id, name: d.name, status: d.status, style: d.style, kind: d.kind, design: d.design }))
    : [];
  const [heroSvg, samples] = await Promise.all([
    designSvg(heroDesign(), { width: 760 }),
    Promise.all(STYLE_FAMILIES.map(async (f) => ({ id: f.id, label: f.label, description: f.description, svg: await designSvg(familySample(f.id), { width: 420 }) }))),
  ]);

  return (
    <>
      {/* Hero */}
      <section aria-labelledby="studio-hero" className="relative overflow-hidden bg-gradient-to-br from-primary-dark via-primary to-primary-hover text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-20">
          <div>
            <Eyebrow dark>SIGNATURE STUDIO</Eyebrow>
            <h1 id="studio-hero" className="mt-5 font-display text-white text-4xl leading-tight sm:text-5xl lg:text-6xl">
              Create Your Own <span className="italic text-gold">Handwritten</span> Signature
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/85">
              Design a signature that looks and feels uniquely yours. Personalize every letter, curve, and flourish. Download your finished design for just {price}.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#studio" className={buttonClass('gold', 'lg')}>
                Design My Signature — Free Preview
              </a>
              <a href="#styles" className={buttonClass('inverse', 'lg')}>
                Explore Signature Styles
              </a>
            </div>
            <p className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/80">
              <span>
                <strong className="text-gold">{price}</strong> per custom signature
              </span>
              <span>No subscription required.</span>
            </p>
          </div>
          <div className="relative">
            <div className="rounded-2xl bg-white p-6 shadow-2xl sm:p-10">
              <div aria-label="Sample signature for Jordan Lee" role="img" className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: heroSvg }} />
              <div className="mt-2 border-t border-slate-300 pt-2 text-xs text-slate-500">Sample design · fictional name</div>
            </div>
            <Sparkles aria-hidden className="absolute -right-3 -top-3 size-10 text-gold" />
          </div>
        </div>
      </section>

      {/* Benefits */}
      <Section tone="white" labelledBy="studio-benefits" className="[&>div]:py-14">
        <h2 id="studio-benefits" className="sr-only">
          Why Signature Studio
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <li key={b.title} className="flex gap-4 rounded-2xl border border-border bg-ivory/60 p-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-gold">
                <b.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block font-semibold text-heading">{b.title}</span>
                <span className="mt-1 block text-sm text-slate-text">{b.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* The editor */}
      <section id="studio" aria-labelledby="studio-try" className="scroll-mt-20 bg-cream/60">
        <div className="mx-auto max-w-[96rem] px-3 py-12 sm:px-6 lg:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="studio-try" className="font-display text-3xl text-heading sm:text-4xl">
              Try the Signature Studio
            </h2>
            <p className="mt-3 text-lg text-slate-text">Design and preview your signature now. Sign in and pay {price} to download.</p>
            {settings.promoMessage ? <p className="mt-3 inline-block rounded-full bg-soft-gold px-4 py-1 text-sm font-semibold text-primary">{settings.promoMessage}</p> : null}
          </div>
          <div className="mt-8">
            {settings.freePreview || userId ? (
              <StudioEditor settings={publicStudioSettings(settings)} signedIn={Boolean(userId)} saved={saved} resume={resume} />
            ) : (
              <div className="rounded-2xl border border-border bg-white p-8 text-center">
                <p className="text-lg text-heading">Sign in to use Signature Studio.</p>
                <Link href={`/sign-in?next=${encodeURIComponent('/signature-studio/continue')}`} className={buttonClass('primary', 'lg', 'mt-4')}>
                  Sign In
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Styles */}
      <Section id="styles" tone="white" labelledBy="styles-heading">
        <Heading id="styles-heading" center sub="Twelve signature families, each with four variations. Every one starts from your own name and can be fully personalized.">
          Explore Signature Styles
        </Heading>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {samples.map((s) => (
            <li key={s.id} className="rounded-2xl border border-border bg-white p-4 shadow-card">
              <div role="img" aria-label={`${s.label} sample`} className="flex h-28 items-center justify-center [&>svg]:h-auto [&>svg]:max-h-28 [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: s.svg }} />
              <p className="mt-3 font-semibold text-heading">{s.label}</p>
              <p className="text-sm text-slate-text">{s.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center">
          <a href="#studio" className={buttonClass('primary', 'lg')}>
            Start Designing <ArrowRight className="size-4" aria-hidden />
          </a>
        </p>
      </Section>

      {/* Journey */}
      <Section tone="blush" labelledBy="journey-heading">
        <Heading id="journey-heading" center>
          From idea to signature in five steps
        </Heading>
        <ol className="mt-10 grid gap-4 sm:grid-cols-5">
          {[
            ['Design', 'Type, draw or upload, then personalize every detail.'],
            ['Preview', 'See it on paper, ivory, navy and a document signature line.'],
            ['Sign in', 'Create a free account or sign in. Your design comes with you.'],
            [`Pay ${price}`, 'One payment for this design. No subscription.'],
            ['Download', 'Transparent PNG, SVG and JPEG, saved to your library.'],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-2xl border border-border bg-white p-5 text-center">
              <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-gold">{i + 1}</span>
              <p className="mt-3 font-semibold text-heading">{t}</p>
              <p className="mt-1 text-sm text-slate-text">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Cross-sell */}
      {settings.crossSell ? (
        <Section tone="dark" labelledBy="work-heading">
          <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
            <Heading id="work-heading" dark sub="Now that you've created your signature, use Signature Tender to sign and send documents online whenever you need.">
              Put Your Signature to Work
            </Heading>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <Link href={userId ? '/app/documents/new' : '/sign-up'} className={buttonClass('gold', 'lg')}>
                Sign a Document
              </Link>
              <Link href={userId ? '/app/documents/new' : '/sign-up'} className={buttonClass('inverse', 'lg')}>
                Send for Signature
              </Link>
              <Link href="/product" className={buttonClass('inverse-ghost', 'lg')}>
                Explore Signature Tender
              </Link>
            </div>
          </div>
        </Section>
      ) : null}

      {/* FAQ and fine print */}
      <Section tone="white" labelledBy="studio-faq">
        <Heading id="studio-faq" center>
          Signature Studio questions
        </Heading>
        <dl className="mx-auto mt-8 grid max-w-4xl gap-6 sm:grid-cols-2">
          {[
            ['Is designing free?', `Yes. Designing and previewing are free. You pay ${price} only when you download a finished design.`],
            ['What do I get?', 'A high-resolution transparent PNG, an SVG (for designs made in the Studio), and a JPEG, plus repeat downloads from your library.'],
            ['Why do I need an account?', 'Your purchase is tied to your account, so only you can download your files, and your signature is saved for later.'],
            ['Can I change a purchased design?', 'Your purchased design never changes. You can edit a copy as a new draft at any time.'],
            ['Is it a legal signature?', 'A design is artwork. It does not verify your identity, and having the file does not sign a document by itself. Signing on Signature Tender uses your own verified link or account.'],
            ['Which fonts are used?', 'Fonts from Google Fonts under the SIL Open Font License or Apache License 2.0, which allow commercial use. Typed letters are converted to vector outlines in your files.'],
          ].map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold text-heading">{q}</dt>
              <dd className="mt-1 text-sm text-slate-text">{a}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* Footer strip */}
      <div className="border-t border-border bg-ivory">
        <ul className="mx-auto grid max-w-7xl gap-4 px-4 py-8 text-center sm:grid-cols-4 sm:px-6">
          {[
            [Sparkles, 'Free to Design'],
            [Download, `Only ${price} to Download`],
            [Layers, 'Use Anywhere'],
            [FileSignature, 'Sign with Signature Tender'],
          ].map(([Icon, label]) => {
            const I = Icon as typeof Sparkles;
            return (
              <li key={label as string} className="flex items-center justify-center gap-2 font-semibold text-heading">
                <I className="size-5 text-gold" aria-hidden /> {label as string}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
