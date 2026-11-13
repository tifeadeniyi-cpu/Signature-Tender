import type { ReactNode } from 'react';
import { Plug, Code2 } from 'lucide-react';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { IntegrationsNav } from './_components/integrations-nav';

export default async function IntegrationsLayout({ children }: { children: ReactNode }) {
  await requireWorkspace();
  return (
    <>
      <PageHeader
        icon={<Plug className="size-8" />}
        title="Integrations"
        description="Connect your favorite apps and automate document signing."
        actions={
          <ButtonLink href="/app/settings/developers" variant="secondary" size="sm">
            <Code2 className="size-4" aria-hidden />
            Explore API
          </ButtonLink>
        }
      />
      <IntegrationsNav />
      {children}
    </>
  );
}
