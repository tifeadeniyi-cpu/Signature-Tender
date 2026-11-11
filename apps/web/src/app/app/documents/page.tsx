import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { listDocuments, hasPermission, DOCUMENT_TYPES } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/documents/status-badge';

export const metadata = { title: 'Documents' };

const typeLabel = (v: string | null) =>
  DOCUMENT_TYPES.find((d) => d.value === v)?.label ?? 'Document';
const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

export default async function DocumentsPage() {
  const { user, membership } = await requireWorkspace();
  const canCreate = hasPermission(membership.permissions, 'documents.create');
  const docs = await listDocuments(db(), { userId: user.id }, membership.workspace.id);
  const newButton = canCreate ? (
    <ButtonLink href="/app/documents/new">
      <Plus className="size-4" aria-hidden /> New document
    </ButtonLink>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Prepare documents and choose who signs them."
        actions={newButton}
      />
      {docs.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="No documents yet"
          action={newButton}
        >
          {canCreate
            ? 'Upload a PDF to start preparing your first signing request.'
            : 'Documents shared with you in this workspace will appear here.'}
        </EmptyState>
      ) : (
        <ul
          className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white shadow-card"
          aria-label="Documents"
        >
          {docs.map((d) => (
            <li key={d.id}>
              <Link
                href={`/app/documents/${d.id}/prepare/review`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-blush/50"
              >
                <FileText className="size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-heading">{d.title}</p>
                  <p className="text-xs">
                    {typeLabel(d.documentType)} · {d.pageCount ?? 0}{' '}
                    {d.pageCount === 1 ? 'page' : 'pages'} · {d.recipientCount}{' '}
                    {d.recipientCount === 1 ? 'recipient' : 'recipients'}
                  </p>
                </div>
                <StatusBadge status={d.status} />
                <span className="w-full text-xs sm:w-auto">Updated {fmt.format(d.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
