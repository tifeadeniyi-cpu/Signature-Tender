import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { listDeletedDrafts } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/feedback';
import { RestoreDraftButton } from '@/components/documents/library-buttons';

export const metadata = { title: 'Recently deleted' };
const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export default async function DeletedDraftsPage() {
  const { user, membership } = await requireWorkspace();
  const drafts = await listDeletedDrafts(db(), { userId: user.id }, membership.workspace.id);
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/app/documents"
        className="mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Documents
      </Link>
      <PageHeader
        title="Recently deleted"
        description="Deleted drafts can be restored for a limited time. Sent documents are never deleted from here."
      />
      {drafts.length === 0 ? (
        <EmptyState icon={<Trash2 className="size-5" />} title="Nothing to restore">
          Drafts you delete appear here until the restore window ends.
        </EmptyState>
      ) : (
        <ul
          className="divide-y divide-border rounded-2xl border border-border bg-white shadow-card"
          aria-label="Deleted drafts"
        >
          {drafts.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-semibold text-heading">{d.title}</p>
                <p className="text-xs">
                  Deleted {fmt.format(d.deletedAt!)} · can be restored until{' '}
                  {fmt.format(d.restorableUntil)}
                </p>
              </div>
              <RestoreDraftButton documentId={d.id} title={d.title} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
