import { MarketingHeader, MarketingFooter } from '@/components/marketing';
import { JsonLd } from '@/components/json-ld';
import { organizationJsonLd } from '@/lib/seo';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <MarketingHeader />
      <main id="main">{children}</main>
      <MarketingFooter />
    </>
  );
}
