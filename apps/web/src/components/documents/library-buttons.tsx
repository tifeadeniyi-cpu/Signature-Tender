'use client';
import { useActionState } from 'react';
import { Archive, ArchiveRestore, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { archiveAction, restoreDraftAction } from '@/app/app/documents/library-actions';

export function ArchiveButton({
  documentId,
  archived,
  title,
  size = 'sm',
}: {
  documentId: string;
  archived: boolean;
  title: string;
  size?: 'sm' | 'md';
}) {
  const [state, act, pending] = useActionState(
    archiveAction.bind(null, documentId, !archived),
    null,
  );
  return (
    <form action={act} className="inline-flex flex-col items-start gap-1">
      <Button
        type="submit"
        variant="ghost"
        size={size}
        loading={pending}
        aria-label={`${archived ? 'Unarchive' : 'Archive'} ${title}`}
      >
        {archived ? (
          <ArchiveRestore className="size-4" aria-hidden />
        ) : (
          <Archive className="size-4" aria-hidden />
        )}
        {archived ? 'Unarchive' : 'Archive'}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="max-w-56 text-xs text-error">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function RestoreDraftButton({ documentId, title }: { documentId: string; title: string }) {
  const [state, act, pending] = useActionState(restoreDraftAction.bind(null, documentId), null);
  if (state?.ok)
    return (
      <span role="status" className="text-sm text-success">
        {state.message}
      </span>
    );
  return (
    <form action={act} className="inline-flex flex-col items-end gap-1">
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        aria-label={`Restore ${title}`}
      >
        <Undo2 className="size-4" aria-hidden /> Restore
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-xs text-error">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
