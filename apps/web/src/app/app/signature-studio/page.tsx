import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@st/core';
import { getDesign, listLibrary, normalizeDesign, publicStudioSettings, type Design } from '@st/core/studio/server';
import { PageHeader } from '@/components/ui/page-header';
import { StudioEditor } from '@/components/studio/editor';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { studioSettings } from '@/lib/studio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signature Studio' };

export default async function AppStudioPage({ searchParams }: { searchParams: Promise<{ design?: string }> }) {
  const { user } = await requireWorkspace();
  const settings = await studioSettings();
  if (!settings.enabled) notFound();
  const { design: id } = await searchParams;
  let resume: { id: string | null; design: Design } | null = null;
  if (id) {
    const row = await getDesign(db(), { userId: user.id }, id);
    if (row) resume = { id: row.status === 'draft' ? row.id : null, design: normalizeDesign(row.design) };
  }
  const saved = (await listLibrary(db(), user.id)).slice(0, 30).map((d) => ({ id: d.id, name: d.name, status: d.status, style: d.style, kind: d.kind, design: d.design }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Signature Studio"
        description={`Design your own handwritten signature. Preview free, download for ${formatMoney(settings.priceCents, settings.currency)}.`}
        actions={
          <Link href="/app/signature-studio/library" className="text-sm font-semibold text-primary hover:underline">
            My Signatures
          </Link>
        }
      />
      <div id="studio">
        <StudioEditor settings={publicStudioSettings(settings)} signedIn saved={saved} resume={resume} context="app" />
      </div>
    </div>
  );
}
