import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { INTEGRATIONS, formatMoney, getConfigValue, getPricing } from '@st/core';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { appUrl } from '@/lib/billing';
import { ProductHero, ProductFeatureGrid } from '@/components/product/hero';
import {
  DocumentManagementSpotlight,
  DocumentPreparationSpotlight,
  SignatureStudioSpotlight,
  SigningWorkflowsSpotlight,
  TeamShowcase,
  TemplateShowcase,
} from '@/components/product/spotlights';
import {
  DeveloperAPISection,
  FinalCTA,
  HowItWorks,
  IntegrationsShowcase,
  PricingPreview,
  SecurityFeatures,
} from '@/components/product/sections';
import { ProductFAQ, type FaqItem } from '@/components/product/faq';
import { Heading, Section } from '@/components/product/primitives';
import { PageViewTracker } from '@/components/product/reveal';
import { SIGNATURE_FAMILIES } from '@/components/product/studio-fonts';
import { BRAND_ASSETS } from '@/lib/brand-assets';

export const dynamic = 'force-dynamic';

const TITLE = 'Electronic Signature Features | Signature Tender';
const DESCRIPTION =
  "Explore Signature Tender's electronic signing features, personalized signatures, document templates, multi-party workflows, secure document management, and flexible pay-as-you-go pricing.";

export function generateMetadata(): Metadata {
  const url = appUrl('/product');
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title: TITLE,
      description: DESCRIPTION,
      siteName: 'Signature Tender',
      images: [
        {
          url: appUrl(BRAND_ASSETS.socialCard.src),
          width: BRAND_ASSETS.socialCard.width,
          height: BRAND_ASSETS.socialCard.height,
          alt: 'Signature Tender',
        },
      ],
    },
    twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
  };
}

/** Where a call to action goes: the app when signed in, otherwise sign-up that returns there. */
function appLink(signedIn: boolean, path: string) {
  return signedIn ? path : `/sign-up?next=${encodeURIComponent(path)}`;
}

export default async function ProductPage() {
  const [{ plans, prices }, session, maxSigners, linkDays, nonce] = await Promise.all([
    getPricing(db()),
    getSession(),
    getConfigValue<number>(db(), 'limits.max_signers_per_request', 5),
    getConfigValue<number>(db(), 'signing.link_valid_days', 30),
    headers().then((h) => h.get('x-nonce') ?? undefined),
  ]);
  const signedIn = Boolean(session?.user.emailVerified);
  const single = prices.find((p) => p.code === 'single_request');
  const bundles = prices.filter((p) => p.credits > 1).sort((a, b) => a.amountCents - b.amountCents);
  const paidPlans = plans
    .filter((p) => !p.isCustom && p.monthlyPriceCents && p.monthlyPriceCents > 0)
    .sort((a, b) => a.monthlyPriceCents! - b.monthlyPriceCents!);
  const singleLabel = single ? formatMoney(single.amountCents, single.currency) : null;
  const startHref = appLink(signedIn, '/app/documents/new');
  const signatureFont = SIGNATURE_FAMILIES.find((f) => f.id === 'calligraphy')!.family;

  const faq: FaqItem[] = [
    {
      q: 'What is Signature Tender?',
      a: 'An electronic signature platform. Upload a PDF, add the people who need to sign, place fields, and send. Everyone signs from a secure link, and you get the completed PDF with an evidence certificate.',
    },
    {
      q: 'Do I need a subscription?',
      a: `No. You can pay for each signing request${singleLabel ? ` (${singleLabel})` : ''} or buy prepaid credits. Monthly plans are optional, for people who send often, and are never started automatically.`,
    },
    {
      q: 'How much does it cost to send one document?',
      a: singleLabel
        ? `${singleLabel} per signing request, in USD. That covers one document, up to ${maxSigners} signers, email invitations, and the completed PDF with its evidence certificate. Credit packs lower the price per request.`
        : 'See the pricing page for current prices.',
    },
    {
      q: 'Can I send documents to multiple people?',
      a: `Yes. One request includes up to ${maxSigners} signers. They can sign in a set order or at the same time, and you can add approvers, reviewers and people who only receive a copy.`,
    },
    {
      q: 'Do recipients need an account?',
      a: 'No. Recipients sign from a personal link in their email. You can also require a one-time code sent to their email before they can open the document. Recipients never pay to sign.',
    },
    {
      q: 'Can I type, draw, or upload my signature?',
      a: 'Yes. When signing you can type your name in a signature style, draw your signature with a mouse or finger, or upload an image of it.',
    },
    {
      q: 'What makes Signature Studio different?',
      a: 'It treats your typed signature as something personal rather than a plain font. Today you can choose from three handwriting styles when you sign. More signature families, slant, flourishes, underlines, ink weight and saved signatures are coming; you can try them in the preview on this page.',
    },
    {
      q: 'Can I track whether someone has signed?',
      a: 'Yes. Each document shows every recipient’s status and an activity history: when the invitation was emailed, when the link was opened, when they agreed to sign electronically, signed or declined, and when the completed copy was downloaded.',
    },
    {
      q: 'How do I retrieve completed documents?',
      a: 'Senders download the signed PDF and certificate from Documents. Recipients get a completion email; its buttons ask them to confirm their email with a one-time code before the document opens. Anyone can also use Get your documents to find copies sent to their email.',
    },
    {
      q: 'Can I reuse document templates?',
      a: 'Yes. Save a document with its recipient roles and fields as a template, publish it, and create new documents from it. Templates can be duplicated, organized by category, shared with your workspace or kept private.',
    },
    {
      q: 'Does Signature Tender support team accounts?',
      a: 'Yes. Workspaces support team invitations, roles and permissions, groups, shared templates, workspace branding and one billing account.',
    },
    {
      q: 'Can I integrate Signature Tender into my own application?',
      a: 'Yes. The REST API lets you upload documents, add recipients and fields, send requests, open embedded signing sessions and download completed files, with signed webhooks for status updates. Beam Artist, Jectstack and Slack connect today; other integrations are planned and labelled Coming soon.',
    },
    {
      q: 'Are electronic signatures legally recognized?',
      a: 'Many jurisdictions recognize electronic signatures, but validity depends on applicable law, the type of document and the signing circumstances. Some documents need other formalities. Signature Tender records evidence of each signing but does not provide legal advice; check with a lawyer for important agreements.',
    },
    {
      q: 'How are my documents protected?',
      a: 'Files are stored privately and only served through the app to people with access, over encrypted connections. Each workspace’s data is isolated at the database level, every file has a SHA-256 fingerprint, signing events are chained so changes can be detected, and signing links are stored only as hashes.',
    },
    {
      q: 'What happens if a signing link expires?',
      a: `Signing links last until the request’s expiration date, or ${linkDays} days if none is set. A recipient whose link no longer works can verify their email on Get your documents and receive a new link while the request is still open. Links in completion emails can be renewed the same way.`,
    },
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Signature Tender',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: appUrl('/product'),
        description: DESCRIPTION,
        ...(single
          ? {
              offers: {
                '@type': 'Offer',
                price: (single.amountCents / 100).toFixed(2),
                priceCurrency: single.currency,
                description: 'One signing request',
              },
            }
          : {}),
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <PageViewTracker />
      <ProductHero startHref={startHref} priceLabel={singleLabel} signatureFont={signatureFont} />
      <ProductFeatureGrid />
      <DocumentPreparationSpotlight startHref={startHref} signatureFont={signatureFont} />
      <SignatureStudioSpotlight families={SIGNATURE_FAMILIES} />
      <SigningWorkflowsSpotlight />
      <DocumentManagementSpotlight documentsHref={appLink(signedIn, '/app/documents')} />
      <SecurityFeatures />
      <TemplateShowcase templatesHref={appLink(signedIn, '/app/templates')} />
      <TeamShowcase teamHref={appLink(signedIn, '/app/team')} />
      <IntegrationsShowcase integrations={INTEGRATIONS} />
      <DeveloperAPISection />
      <HowItWorks />
      <PricingPreview
        startHref={startHref}
        data={{
          single: singleLabel,
          creditsFrom: bundles[0] ? formatMoney(bundles[0].amountCents, bundles[0].currency) : null,
          plansFrom: paidPlans[0]
            ? formatMoney(paidPlans[0].monthlyPriceCents!, paidPlans[0].currency)
            : null,
          maxSigners,
        }}
      />
      <Section id="faq" tone="blush" labelledBy="faq-heading">
        <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <Heading id="faq-heading" sub="Straight answers about signing, pricing and security.">
            Frequently Asked Questions
          </Heading>
          <ProductFAQ items={faq} />
        </div>
      </Section>
      <div className="bg-blush/50 pt-4">
        <FinalCTA startHref={startHref} priceLabel={singleLabel} />
      </div>
    </>
  );
}
