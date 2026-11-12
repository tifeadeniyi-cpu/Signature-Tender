import { getBrand, hasPermission } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { BrandingForm, LogoForm } from './branding-form';

export const metadata = { title: 'Branding' };

export default async function BrandingPage() {
  const { membership } = await requireWorkspace();
  const ws = membership.workspace;
  const canManage = hasPermission(membership.permissions, 'workspace.manage');
  const brand = await getBrand(db(), ws.id);
  return (
    <div className="flex flex-col gap-6">
      {!canManage ? (
        <Alert tone="info">Only workspace owners and admins can change branding.</Alert>
      ) : null}
      <Card>
        <CardHeader
          title="Branding"
          description="Recipients see your name and colour in signing emails, and your name and logo above the signing page."
        />
        <BrandingForm
          disabled={!canManage}
          workspaceName={ws.name}
          initial={{ brandName: brand?.brandName ?? '', color: brand?.color ?? null }}
        />
      </Card>
      <Card>
        <CardHeader
          title="Logo"
          description="Shown to recipients on signing pages, below the Signature Tender header."
        />
        <LogoForm
          disabled={!canManage}
          hasLogo={Boolean(brand?.hasLogo)}
          logoSrc={
            brand?.hasLogo ? `/api/brand/${ws.id}/logo?v=${brand.logoSha256?.slice(0, 12)}` : null
          }
        />
      </Card>
    </div>
  );
}
