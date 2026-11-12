import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { loadTemplatePage } from '@/lib/templates';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, Badge } from '@/components/ui/feedback';
import { TemplateNav } from './template-nav';

const STATUS: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' }> = {
  active: { label: 'Active', tone: 'success' },
  draft: { label: 'Draft', tone: 'warning' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export default async function TemplateLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadTemplatePage(id);
  const t = data.template;
  const s = STATUS[t.status]!;
  return (
    <div>
      <Link
        href="/app/templates"
        className="mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Templates
      </Link>
      <PageHeader
        title={t.title}
        description={`${t.category} · ${t.publishedVersion ? `Version ${t.publishedVersion} published` : 'Not published yet'}${data.draft && t.publishedVersion ? ' · Unpublished changes' : ''}`}
        actions={<Badge tone={s.tone}>{s.label}</Badge>}
      />
      <TemplateNav id={id} canUse={data.canUse} />
      {!data.canEdit ? (
        <Alert tone="info" className="mb-4">
          You can view this template, but you cannot change it.
        </Alert>
      ) : t.status === 'archived' ? (
        <Alert tone="info" className="mb-4">
          This template is archived. Restore it on the Overview tab to edit or use it.
        </Alert>
      ) : null}
      {children}
    </div>
  );
}
