import Image from 'next/image';
import Link from 'next/link';
import { MarketingNav } from './marketing-nav';
import { BRAND_ASSETS } from '@/lib/brand-assets';

export function MarketingHeader() {
  return <MarketingNav />;
}

/** Footer columns. Only pages and sections that exist are linked. */
const FOOTER: { title: string; links: [string, string][] }[] = [
  {
    title: 'Product',
    links: [
      ['Features', '/product#features'],
      ['Signature Studio', '/signature-studio'],
      ['Templates', '/product#templates'],
      ['Integrations', '/product#integrations'],
      ['Pricing', '/pricing'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['API documentation', '/developers'],
      ['FAQ', '/product#faq'],
      ['Get your documents', '/retrieve'],
      ['Verify a certificate', '/verify'],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['Terms', '/legal/terms'],
      ['Privacy', '/legal/privacy'],
      ['Electronic Signature Disclosure', '/legal/esign-disclosure'],
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Image {...BRAND_ASSETS.horizontalLight} alt="Signature Tender" className="h-auto w-44" />
          <p className="mt-4 font-display text-lg text-heading">Send. Sign. Pay Once.</p>
          <p className="mt-2 max-w-xs text-sm">
            Electronic signatures without a subscription. Pay only when you send a document.
          </p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-heading">
              {col.title}
            </h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {col.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="hover:text-primary hover:underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs sm:px-6">
          © {new Date().getFullYear()} Signature Tender. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
