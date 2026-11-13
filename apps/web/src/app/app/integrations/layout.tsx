import Link from 'next/link';
import { Plug, Code2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { buttonClass } from '@/components/ui/button';
import { IntegrationsNav } from './integrations-nav';

export const metadata = { title: 'Integrations' };

export default function IntegrationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        icon={<Plug className="size-8" />}
        title="Integrations"
        description="Connect your favorite apps and automate document signing."
        actions={
          <Link href="/app/api-docs" className={buttonClass('secondary', 'sm')}>
            <Code2 className="size-4" aria-hidden /> Explore API
          </Link>
        }
      />
      <IntegrationsNav />
      {children}
    </>
  );
}
