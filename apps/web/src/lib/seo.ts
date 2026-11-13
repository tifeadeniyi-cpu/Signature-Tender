import type { Metadata } from 'next';

/**
 * Search and link-preview helpers for the public site.
 *
 * Every public page gets one canonical URL on the production domain, so the vercel.app address
 * and preview deployments never compete with signaturetender.com in search results.
 */
export const SITE_NAME = 'Signature Tender';
const FALLBACK_SITE_URL = 'https://signaturetender.com';

/** The canonical origin, without a trailing slash. SITE_URL wins, then BETTER_AUTH_URL. */
export function siteUrl(): string {
  const raw = process.env.SITE_URL || process.env.BETTER_AUTH_URL || FALLBACK_SITE_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}

export const absoluteUrl = (path: string) => new URL(path, siteUrl()).toString();

/** Link-preview images (1200 × 630, navy and gold). */
export const OG_IMAGES = {
  default: {
    url: '/branding/signature-tender/social/og-default.png',
    width: 1200,
    height: 630,
    alt: 'Signature Tender: send documents for signature and pay only when you send',
  },
  studio: {
    url: '/branding/signature-tender/social/og-signature-studio.png',
    width: 1200,
    height: 630,
    alt: 'Signature Studio: create your own handwritten signature',
  },
} as const;

type PageSeo = {
  /** The full title shown in search results (the site template is not added). */
  title: string;
  description: string;
  /** Path of the canonical URL, for example "/pricing". */
  path: string;
  image?: (typeof OG_IMAGES)[keyof typeof OG_IMAGES];
};

/** Metadata for an indexable public page: canonical URL, Open Graph and Twitter card. */
export function pageMetadata({
  title,
  description,
  path,
  image = OG_IMAGES.default,
}: PageSeo): Metadata {
  const url = absoluteUrl(path);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      siteName: SITE_NAME,
      locale: 'en_US',
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

/** Pages that must never appear in search results (private, per-user or token pages). */
export const NO_INDEX: Metadata['robots'] = { index: false, follow: false };

/**
 * Paths crawlers are asked not to visit. Recipient links (/sign, /retrieve, /invite, /claim)
 * carry secret tokens: a crawler opening one would also show up in that document's activity.
 */
export const PRIVATE_PATHS = [
  '/app',
  '/admin',
  '/api/',
  '/sign/',
  '/retrieve',
  '/invite/',
  '/claim/',
  '/my-documents',
  '/onboarding',
  '/two-factor',
  '/reset-password',
  '/verify-email',
  '/signature-studio/checkout/',
  '/signature-studio/receipt/',
  '/signature-studio/design/',
  '/signature-studio/return',
  '/signature-studio/continue',
  '/signature-studio/library',
  '/signature-studio?design=',
];

/** Site-wide structured data: the organization and the website. */
export function organizationJsonLd() {
  const url = siteUrl();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${url}/#organization`,
        name: SITE_NAME,
        url,
        logo: {
          '@type': 'ImageObject',
          url: absoluteUrl('/branding/signature-tender/app-icon/icon-512.png'),
          width: 512,
          height: 512,
        },
        slogan: 'Send. Sign. Pay Once.',
        ...(socialProfiles().length ? { sameAs: socialProfiles() } : {}),
      },
      {
        '@type': 'WebSite',
        '@id': `${url}/#website`,
        name: SITE_NAME,
        url,
        inLanguage: 'en-US',
        publisher: { '@id': `${url}/#organization` },
      },
    ],
  };
}

function socialProfiles(): string[] {
  return [
    process.env.SOCIAL_LINKEDIN_URL,
    process.env.SOCIAL_INSTAGRAM_URL,
    process.env.SOCIAL_YOUTUBE_URL,
  ].filter((u): u is string => Boolean(u && /^https:\/\//.test(u)));
}

/** FAQPage structured data from question and answer pairs shown on the page. */
export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
