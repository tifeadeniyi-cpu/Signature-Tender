import {
  ArrowRight,
  BadgeCheck,
  Check,
  Code2,
  Fingerprint,
  History,
  KeyRound,
  Link2,
  Lock,
  Send,
  Upload,
  Webhook,
  FileSearch,
  Coins,
  Layers,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import type { IntegrationInfo } from '@st/core';
import { cn } from '@/lib/cn';
import { AvailabilityBadge, Eyebrow, Heading, Section, SignatureStroke } from './primitives';
import { EvidenceMock } from './mocks';
import { TrackedLink } from './tracked-link';
import { Reveal } from './reveal';

const SECURITY = [
  {
    icon: Lock,
    title: 'Protected Document Storage',
    body: 'Files are stored privately, sent over encrypted connections, and only served through the app to people with access. Each workspace is isolated at the database level.',
  },
  {
    icon: Fingerprint,
    title: 'Tamper-Evident Records',
    body: 'Every file gets a SHA-256 fingerprint and every signing event is chained to the one before it, so later changes can be detected.',
  },
  {
    icon: History,
    title: 'Signature Activity History',
    body: 'Invitations, link opens, consent to sign electronically, signatures, declines and downloads are recorded with timestamps.',
  },
  {
    icon: Link2,
    title: 'Secure Signing Links',
    body: 'Personal links that expire, are stored only as hashes, and can require a one-time code sent to the recipient’s email.',
  },
  {
    icon: BadgeCheck,
    title: 'Document Verification',
    body: 'The completion certificate lists the fingerprints of the signed copy, so anyone can check a copy against it.',
  },
  {
    icon: KeyRound,
    title: 'Access Permissions',
    body: 'Roles decide who can view, send, retrieve and administer agreements in a workspace.',
  },
];

export function SecurityFeatures() {
  return (
    <Section id="security" tone="dark" labelledBy="security-heading">
      <Reveal name="security">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <Eyebrow dark>SECURITY AND EVIDENCE</Eyebrow>
            <div className="mt-4">
              <Heading
                id="security-heading"
                dark
                sub="Signature Tender is designed to protect your documents and preserve evidence of signing activity."
              >
                Built with Security at Every Step.
              </Heading>
            </div>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {SECURITY.map((s) => (
                <li
                  key={s.title}
                  className="rounded-2xl border border-white/15 bg-white/5 p-5 transition hover:border-rose-gold/60"
                >
                  <s.icon className="size-6 text-rose-gold" aria-hidden />
                  <h3 className="mt-3 font-display text-lg text-white">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-white/80">{s.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col justify-center gap-6">
            <EvidenceMock />
            <p className="rounded-xl border border-white/15 p-4 text-sm text-white/80">
              Electronic signature validity depends on applicable law, document type, and signing
              circumstances. Signature Tender does not provide legal advice.
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

function monogram(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function IntegrationsShowcase({ integrations }: { integrations: IntegrationInfo[] }) {
  const sorted = [...integrations].sort((a, b) => Number(b.available) - Number(a.available));
  return (
    <Section id="integrations" tone="white" labelledBy="integrations-heading">
      <Reveal name="integrations">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow>INTEGRATIONS</Eyebrow>
            <div className="mt-4">
              <Heading
                id="integrations-heading"
                sub="Bring signature workflows into your existing applications and business processes."
              >
                Connect Signing to the Tools You Already Use.
              </Heading>
            </div>
          </div>
          <p className="max-w-xs text-sm">
            Integrations marked Available can be connected today from Integrations in your
            workspace. Coming soon means planned, not yet connectable.
          </p>
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((i) => (
            <li
              key={i.key}
              className={cn(
                'flex flex-col rounded-2xl border p-4 transition',
                i.available
                  ? 'border-primary/30 bg-white shadow-card hover:shadow-lg'
                  : 'border-border bg-ivory',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={cn(
                    'flex size-11 items-center justify-center rounded-xl font-display text-lg',
                    i.available
                      ? 'bg-primary text-white'
                      : 'bg-white text-primary ring-1 ring-border',
                  )}
                  aria-hidden
                >
                  {monogram(i.name)}
                </span>
                <AvailabilityBadge value={i.available ? 'available' : 'soon'} />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-heading">{i.name}</h3>
              <p className="mt-0.5 text-xs text-slate-text">{i.category}</p>
              <p className="mt-2 line-clamp-3 text-xs">{i.description}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs">
          Names are trademarks of their owners. Listing a product does not imply endorsement.
        </p>
      </Reveal>
    </Section>
  );
}

const API_FEATURES = [
  {
    icon: Send,
    title: 'API signing requests',
    body: 'Upload a PDF, add recipients and fields, and send, all from your code.',
  },
  {
    icon: Code2,
    title: 'Embedded signing',
    body: 'Short-lived signing sessions you open inside your own product.',
  },
  {
    icon: FileSearch,
    title: 'Secure document retrieval',
    body: 'Download completed copies with scoped API keys.',
  },
  {
    icon: Webhook,
    title: 'Status webhooks',
    body: 'Signed events when a request is sent, signed, declined or completed.',
  },
  {
    icon: ShieldCheck,
    title: 'Evidence access',
    body: 'Fetch the completion certificate for your own records.',
  },
  {
    icon: Coins,
    title: 'Usage-based billing',
    body: 'API requests are paid per signing request, like the app. No separate API plan.',
  },
];

export function DeveloperAPISection() {
  return (
    <Section id="api" tone="light" labelledBy="api-heading">
      <Reveal name="developer_api">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow>DEVELOPER API</Eyebrow>
            <div className="mt-4">
              <Heading
                id="api-heading"
                sub="Use the REST API and webhooks to send agreements, embed signing, and keep your records in sync."
              >
                Bring Signature Tender Into Your Own Platform.
              </Heading>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <TrackedLink
                href={`/sign-in?next=${encodeURIComponent('/app/api-docs')}`}
                event="api_docs_clicked"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-white hover:bg-primary-hover"
              >
                Sign In for API Documentation <ArrowRight className="size-4" aria-hidden />
              </TrackedLink>
              <TrackedLink
                href="#integrations"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-white px-6 font-semibold text-heading hover:bg-blush"
              >
                View Integrations
              </TrackedLink>
            </div>
            <pre
              tabIndex={0}
              className="mt-8 overflow-x-auto rounded-2xl bg-heading p-5 text-xs leading-relaxed text-white"
              aria-label="Example API request"
            >
              <code>{`curl -X POST https://signaturetender.com/api/v1/documents \\
  -H "Authorization: Bearer $ST_API_KEY" \\
  -F "file=@agreement.pdf" -F "title=Service Agreement"`}</code>
            </pre>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {API_FEATURES.map((f) => (
              <li
                key={f.title}
                className="rounded-2xl border border-border bg-white p-5 shadow-card"
              >
                <f.icon className="size-6 text-primary" aria-hidden />
                <h3 className="mt-3 font-display text-lg">{f.title}</h3>
                <p className="mt-1.5 text-sm">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </Section>
  );
}

const STEPS = [
  {
    icon: Upload,
    title: 'Upload & Prepare',
    body: 'Upload your document, add recipients, and place signature fields.',
  },
  {
    icon: Send,
    title: 'Send & Sign',
    body: 'Choose pay-as-you-go or use available credits, send invitations, and let recipients sign securely.',
  },
  {
    icon: Layers,
    title: 'Track & Retrieve',
    body: 'Track completion and securely retrieve the finalized document and signing evidence.',
  },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works" tone="blush" labelledBy="how-heading">
      <Reveal name="how_it_works">
        <Heading id="how-heading" center>
          From Upload to Signed in Three Simple Steps.
        </Heading>
        <ol className="mt-12 grid gap-6 lg:grid-cols-3 lg:gap-10">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="relative rounded-3xl border border-border bg-white p-7 shadow-card"
            >
              {i < STEPS.length - 1 ? (
                <ArrowRight
                  className="absolute -right-8 top-1/2 hidden size-6 -translate-y-1/2 text-primary lg:block"
                  aria-hidden
                />
              ) : null}
              <span
                className="flex size-11 items-center justify-center rounded-full bg-primary font-display text-xl text-white"
                aria-hidden
              >
                {i + 1}
              </span>
              <s.icon className="mt-5 size-8 text-primary" aria-hidden />
              <h3 className="mt-3 font-display text-2xl">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
              <p className="mt-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </Section>
  );
}

export interface PricingPreviewData {
  single: string | null;
  creditsFrom: string | null;
  plansFrom: string | null;
  maxSigners: number;
}

export function PricingPreview({
  data,
  startHref,
}: {
  data: PricingPreviewData;
  startHref: string;
}) {
  return (
    <Section id="pricing" tone="white" labelledBy="pricing-heading">
      <Reveal name="pricing">
        <Heading
          id="pricing-heading"
          center
          sub="Send one agreement or hundreds. Choose the option that works for you."
        >
          Powerful Signing. Flexible Pricing.
        </Heading>
        <div className="mx-auto mt-12 grid max-w-5xl gap-5 lg:grid-cols-[1.25fr_1fr_1fr]">
          {data.single ? (
            <div className="relative flex flex-col rounded-3xl bg-gradient-to-br from-primary to-primary-hover p-7 text-white shadow-xl">
              <span className="absolute -top-3 left-7 rounded-full bg-rose-gold px-3 py-1 text-xs font-bold text-primary-dark">
                NO SUBSCRIPTION
              </span>
              <h3 className="font-display text-2xl text-white">Pay As You Go</h3>
              <p className="mt-3">
                <span className="font-display text-5xl">{data.single}</span>
                <span className="ml-2 text-white/80">per signing request</span>
              </p>
              <ul className="mt-6 flex flex-col gap-2.5 text-sm">
                {[
                  'No subscription required',
                  'One document per request',
                  `Up to ${data.maxSigners} signers`,
                  'Email invitations',
                  'Completed PDF',
                  'Audit evidence certificate',
                ].map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="size-4 shrink-0 text-rose-gold" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
              <TrackedLink
                href={startHref}
                event="pricing_cta_clicked"
                props={{ plan: 'pay_as_you_go', from: 'pricing' }}
                className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-rose-gold font-semibold text-primary-dark hover:bg-blush"
              >
                Send a Document — {data.single}
              </TrackedLink>
            </div>
          ) : null}
          {(
            [
              [
                'Prepaid Credits',
                data.creditsFrom,
                'Buy credits and use them anytime. Ideal for occasional senders.',
                'View Credit Packs',
                'credits',
              ],
              [
                'Monthly Plans',
                data.plansFrom ? `${data.plansFrom}/month` : null,
                'Included requests every month at a lower price per request.',
                'Explore Subscriptions',
                'plans',
              ],
            ] as const
          ).map(([title, price, body, cta, key]) =>
            price ? (
              <div
                key={key}
                className="flex flex-col rounded-3xl border border-border bg-ivory p-7"
              >
                <h3 className="font-display text-2xl">{title}</h3>
                <p className="mt-3 text-heading">
                  <span className="text-sm">From </span>
                  <span className="font-display text-4xl">{price}</span>
                </p>
                <p className="mt-4 flex-1 text-sm">{body}</p>
                <TrackedLink
                  href="/pricing"
                  event="pricing_cta_clicked"
                  props={{ plan: key }}
                  className="mt-8 inline-flex h-12 items-center justify-center rounded-xl border border-primary font-semibold text-primary hover:bg-primary hover:text-white"
                >
                  {cta}
                </TrackedLink>
              </div>
            ) : null,
          )}
        </div>
        <p className="mt-6 text-center text-sm">
          Prices in USD from our live price list. Recipients never pay to sign. Plans are optional
          and never started automatically.
        </p>
      </Reveal>
    </Section>
  );
}

export function FinalCTA({
  startHref,
  priceLabel,
}: {
  startHref: string;
  priceLabel: string | null;
}) {
  return (
    <section aria-labelledby="final-cta" className="px-4 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary-dark via-primary to-primary-hover px-6 py-14 text-white sm:px-12 lg:py-20">
        <SignatureStroke className="absolute -bottom-6 right-0 w-[38rem] text-rose-gold/40" />
        <div className="relative max-w-2xl">
          <h2 id="final-cta" className="font-display text-4xl leading-tight text-white sm:text-5xl">
            Ready to Make Signing Simpler?
          </h2>
          <p className="mt-4 text-lg text-white/85">
            Send your first document for signature in minutes. No subscription required.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <TrackedLink
              href={startHref}
              event="hero_cta_clicked"
              props={{ cta: 'start_signing', from: 'final' }}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-rose-gold px-6 font-semibold text-primary-dark hover:bg-blush"
            >
              {priceLabel ? `Start Signing — ${priceLabel}` : 'Start Signing'}{' '}
              <ArrowRight className="size-4" aria-hidden />
            </TrackedLink>
            <TrackedLink
              href="/pricing"
              event="pricing_cta_clicked"
              props={{ plan: 'all', from: 'final' }}
              className="inline-flex h-12 items-center rounded-xl border border-white/50 px-6 font-semibold hover:bg-white/10"
            >
              Explore Pricing
            </TrackedLink>
          </div>
          <ul className="mt-10 grid gap-4 text-sm sm:grid-cols-3">
            {[
              [Zap, 'Pay Only When You Need To'],
              [Users, 'Multiple Signers'],
              [ShieldCheck, 'Secure Document Management'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Zap;
              return (
                <li key={label as string} className="flex items-center gap-2">
                  <I className="size-5 text-rose-gold" aria-hidden /> {label as string}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
