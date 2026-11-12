import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  FolderLock,
  LayoutTemplate,
  PenLine,
  Plug,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
  FilePen,
} from 'lucide-react';
import { Heading, Section, SignatureStroke } from './primitives';
import { HeroComposition } from './mocks';
import { TrackedLink } from './tracked-link';

export function ProductHero({
  startHref,
  priceLabel,
  signatureFont,
}: {
  startHref: string;
  priceLabel: string | null;
  signatureFont: string;
}) {
  return (
    <section
      aria-labelledby="product-hero"
      className="relative overflow-hidden bg-gradient-to-br from-primary-dark via-primary to-primary-hover text-white"
    >
      <SignatureStroke className="absolute -right-24 bottom-6 w-[46rem] text-rose-gold/20" />
      <svg
        aria-hidden
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className="absolute inset-x-0 bottom-0 h-16 w-full text-ivory"
      >
        <path d="M0 80C240 120 480 30 760 60s480 50 680-10v70H0z" fill="currentColor" />
        <path
          d="M0 72C260 110 520 22 780 52s460 44 660-12"
          fill="none"
          stroke="#D8AF68"
          strokeOpacity="0.55"
          strokeWidth="2"
        />
      </svg>
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-28 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-36 lg:pt-16">
        <div>
          <p className="inline-block rounded-full border border-rose-gold/70 bg-white/5 px-4 py-1 text-xs font-semibold tracking-[0.18em] text-rose-gold">
            THE COMPLETE E-SIGNATURE EXPERIENCE
          </p>
          <h1
            id="product-hero"
            className="mt-5 font-display text-4xl leading-[1.08] text-white sm:text-5xl xl:text-6xl"
          >
            Everything You Need to{' '}
            <span className="bg-gradient-to-r from-soft-gold via-gold to-[#c99a4e] bg-clip-text italic text-transparent">
              Sign, Send &amp; Manage
            </span>{' '}
            Documents.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-white/85">
            From your first signature to complex business agreements, Signature Tender makes
            electronic signing simple, secure, and accessible, with flexible pricing that works for
            you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <TrackedLink
              href={startHref}
              event="hero_cta_clicked"
              props={{ cta: 'start_signing', from: 'hero' }}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-rose-gold px-6 font-semibold text-primary-dark shadow-lg transition hover:bg-blush"
            >
              {priceLabel ? `Start Signing — From ${priceLabel}` : 'Start Signing'}
              <ArrowRight className="size-4" aria-hidden />
            </TrackedLink>
            <TrackedLink
              href="#features"
              event="hero_cta_clicked"
              props={{ cta: 'explore_features' }}
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/50 px-6 font-semibold transition hover:bg-white/10"
            >
              Explore Features <ChevronDown className="size-4" aria-hidden />
            </TrackedLink>
          </div>
          <ul className="mt-8 grid max-w-lg grid-cols-3 gap-4 text-sm">
            {[
              [Zap, 'No subscription required'],
              [Users, 'Multiple signers'],
              [ShieldCheck, 'Audit evidence included'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Zap;
              return (
                <li key={label as string} className="flex items-center gap-2">
                  <I className="size-5 shrink-0 text-rose-gold" aria-hidden />
                  <span className="leading-tight">{label as string}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="relative">
          <HeroComposition signatureFont={signatureFont} />
          <p className="mt-16 text-center text-xs text-white/70 sm:mt-14">
            Product demonstration · fictional data
          </p>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: PenLine,
    title: 'Electronic Signatures',
    body: 'Collect electronic signatures from anywhere using typed, drawn, or uploaded signatures.',
    href: '#signature-studio',
  },
  {
    icon: Sparkles,
    title: 'Signature Studio',
    body: 'Create personalized signatures with elegant cursive styles, calligraphy, natural curves, and flourishes.',
    href: '#signature-studio',
    note: 'Some styles coming soon',
  },
  {
    icon: FilePen,
    title: 'Document Preparation',
    body: 'Upload documents and place signature, initials, date, and text fields exactly where needed.',
    href: '#prepare',
  },
  {
    icon: Users,
    title: 'Multi-Party Signing',
    body: 'Invite multiple participants, set signing order, and manage signature and approval workflows.',
    href: '#workflows',
  },
  {
    icon: LayoutTemplate,
    title: 'Templates',
    body: 'Save reusable document layouts and signing fields to prepare recurring agreements faster.',
    href: '#templates',
  },
  {
    icon: BarChart3,
    title: 'Real-Time Tracking',
    body: 'Track who has received, opened, and completed documents through a centralized dashboard.',
    href: '#documents',
  },
  {
    icon: FolderLock,
    title: 'Document Management',
    body: 'Organize, find, retrieve, and download completed agreements from a secure workspace.',
    href: '#documents',
  },
  {
    icon: Plug,
    title: 'Integrations & API',
    body: 'Connect Signature Tender to supported business applications or embed signing into your own software.',
    href: '#integrations',
  },
];

export function ProductFeatureGrid() {
  return (
    <Section id="features" labelledBy="features-heading">
      <Heading
        id="features-heading"
        center
        sub="Prepare documents, collect signatures, track progress, and securely manage completed agreements, all in one workspace."
      >
        One Platform. Every Step of Your Signing Process.
      </Heading>
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <li key={f.title}>
            <TrackedLink
              href={f.href}
              className="group flex h-full flex-col rounded-2xl border border-border bg-white p-6 shadow-card transition duration-200 hover:-translate-y-1 hover:border-rose-gold hover:shadow-lg"
            >
              <span className="flex size-12 items-center justify-center rounded-xl bg-primary-surface text-primary transition group-hover:bg-primary group-hover:text-white">
                <f.icon className="size-6" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-xl">{f.title}</h3>
              <p className="mt-2 flex-1 text-[15px]">{f.body}</p>
              {f.note ? <p className="mt-2 text-xs font-semibold text-warning">{f.note}</p> : null}
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Learn more{' '}
                <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
              </span>
            </TrackedLink>
          </li>
        ))}
      </ul>
    </Section>
  );
}
