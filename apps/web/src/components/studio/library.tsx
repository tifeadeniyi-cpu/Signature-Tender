'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Copy, Download, Pencil, Star, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/feedback';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  deleteDesignAction,
  duplicateDesignAction,
  renameDesignAction,
  setDefaultDesignAction,
} from '@/app/(marketing)/signature-studio/actions';

export interface LibraryItem {
  id: string;
  name: string;
  kind: 'signature' | 'initials';
  status: string;
  style: string;
  isDefault: boolean;
  access: string | null;
  purchasedAt: string | null;
  updatedAt: string;
  purchaseId: string | null;
  svg: string;
}

export function SignatureLibrary({ items, editHref }: { items: LibraryItem[]; editHref: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: done } : { ok: false, text: r.message ?? 'Something went wrong.' });
    });
  const purchased = items.filter((i) => i.status === 'purchased');
  const drafts = items.filter((i) => i.status === 'draft');
  const section = (title: string, list: LibraryItem[], empty: string) => (
    <section aria-label={title} className="mt-8">
      <h2 className="font-display text-xl text-heading">{title}</h2>
      {list.length === 0 ? <p className="mt-2 text-sm text-slate-text">{empty}</p> : null}
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((d) => (
          <li key={d.id} className="flex flex-col rounded-2xl border border-border bg-white p-4 shadow-card">
            <div role="img" aria-label={`${d.name} preview`} className="flex h-28 items-center justify-center rounded-lg bg-ivory/60 p-2 [&>svg]:h-auto [&>svg]:max-h-24 [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: d.svg }} />
            <div className="mt-3 flex items-start justify-between gap-2">
              {renaming === d.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = String(new FormData(e.currentTarget).get('name'));
                    setRenaming(null);
                    run(() => renameDesignAction(d.id, name), 'Renamed.');
                  }}
                >
                  <input name="name" defaultValue={d.name} maxLength={60} aria-label="Design name" autoFocus className="h-9 min-w-0 flex-1 rounded-lg border border-border px-2 text-sm" />
                  <button className={buttonClass('primary', 'sm')}>Save</button>
                </form>
              ) : (
                <div className="min-w-0">
                  <p className="truncate font-semibold text-heading">{d.name}</p>
                  <p className="text-xs text-slate-text">
                    {d.style} · {d.kind === 'initials' ? 'Initials' : 'Signature'}
                    {d.purchasedAt ? ` · Purchased ${new Date(d.purchasedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}` : ` · Edited ${new Date(d.updatedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}`}
                  </p>
                </div>
              )}
              {d.isDefault ? <span className="shrink-0 rounded-full bg-soft-gold px-2 py-0.5 text-xs font-semibold text-primary">Default</span> : null}
            </div>
            {d.status === 'purchased' && d.access !== 'active' ? (
              <p className="mt-2 text-xs text-warning">Downloads ended: the payment was refunded or disputed.</p>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {d.status === 'purchased' ? (
                <>
                  <Link href={`/signature-studio/design/${d.id}`} className={buttonClass('primary', 'sm')}>
                    <Download className="size-4" aria-hidden /> Download
                  </Link>
                  {!d.isDefault && d.access === 'active' ? (
                    <button type="button" disabled={pending} onClick={() => run(() => setDefaultDesignAction(d.id), 'Set as your default signature.')} className={buttonClass('secondary', 'sm')}>
                      <Star className="size-4" aria-hidden /> Set default
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <Link href={`${editHref}?design=${d.id}#studio`} className={buttonClass('primary', 'sm')}>
                    Continue editing
                  </Link>
                  <Link href={`/signature-studio/checkout/${d.id}`} className={buttonClass('secondary', 'sm')}>
                    Buy
                  </Link>
                </>
              )}
              <button type="button" disabled={pending} onClick={() => run(() => duplicateDesignAction(d.id), 'Copied to a new draft.')} className={buttonClass('ghost', 'sm')} aria-label={`Duplicate ${d.name}`}>
                <Copy className="size-4" aria-hidden />
              </button>
              <button type="button" disabled={pending} onClick={() => setRenaming(d.id)} className={buttonClass('ghost', 'sm')} aria-label={`Rename ${d.name}`}>
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(d.status === 'purchased' ? 'Remove this signature from your library? Your receipt is kept.' : 'Delete this draft?'))
                    run(() => deleteDesignAction(d.id), d.status === 'purchased' ? 'Removed from your library.' : 'Draft deleted.');
                }}
                className={cn(buttonClass('ghost', 'sm'), 'text-error')}
                aria-label={`Delete ${d.name}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </div>
            {d.purchaseId ? (
              <Link href={`/signature-studio/receipt/${d.purchaseId}`} className="mt-2 text-xs font-semibold text-primary hover:underline">
                Receipt
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div>
      {message ? (
        <Alert tone={message.ok ? 'success' : 'error'} className="mt-4">
          {message.text}
        </Alert>
      ) : null}
      {section('Purchased', purchased, 'Signatures you buy appear here, ready to download again.')}
      {section('Drafts', drafts, 'Designs you save appear here.')}
      <p className="mt-8 text-xs text-slate-text">Purchased designs never change. Edit a copy to make a new version.</p>
    </div>
  );
}
