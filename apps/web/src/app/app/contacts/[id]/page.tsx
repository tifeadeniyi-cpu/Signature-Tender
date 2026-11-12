import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getContact, AppError } from '@st/core';
import { db } from '@/lib/db';
import { requireWorkspace } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/documents/status-badge';
import { ContactActions, ContactForm, CONTACT_TYPE_LABELS } from '../contact-forms';

export const metadata = { title: 'Contact' };
const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireWorkspace();
  let data;
  try {
    data = await getContact(db(), { userId: user.id }, id);
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  const c = data.contact;
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/app/contacts"
        className="mb-3 inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> Contacts
      </Link>
      <PageHeader
        title={c.name}
        description={`${c.email}${c.archivedAt ? ' · Archived' : ''}${c.visibility === 'private' ? ' · Only visible to ' + (data.ownerName ?? 'its owner') : ''}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            {data.canManage ? (
              <ContactForm
                contactId={c.id}
                initial={{
                  name: c.name,
                  email: c.email,
                  phone: c.phone,
                  company: c.company,
                  jobTitle: c.jobTitle,
                  contactType: c.contactType,
                  notes: c.notes,
                  tags: c.tags,
                  visibility: c.visibility,
                }}
              />
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt>Phone</dt>
                <dd className="text-heading">{c.phone ?? '—'}</dd>
                <dt>Company</dt>
                <dd className="text-heading">{c.company ?? '—'}</dd>
                <dt>Job title</dt>
                <dd className="text-heading">{c.jobTitle ?? '—'}</dd>
                <dt>Type</dt>
                <dd className="text-heading">
                  {CONTACT_TYPE_LABELS[c.contactType] ?? c.contactType}
                </dd>
                <dt>Tags</dt>
                <dd className="text-heading">{c.tags.join(', ') || '—'}</dd>
                <dt>Notes</dt>
                <dd className="whitespace-pre-wrap text-heading">{c.notes ?? '—'}</dd>
              </dl>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Document history"
              description="Requests sent to this address that you can see."
            />
            {data.history.length === 0 ? (
              <p className="text-sm">No documents you can see were sent to this address.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="Document history">
                {data.history.map((h) => (
                  <li
                    key={h.requestId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <Link
                      href={`/app/documents/${h.documentId}`}
                      className="font-medium text-heading hover:underline"
                    >
                      {h.title}
                    </Link>
                    <span className="flex items-center gap-2 text-xs">
                      {h.sentAt ? fmt.format(h.sentAt) : 'Not sent'}
                      <StatusBadge status="ready_to_send" requestStatus={h.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {data.canManage ? (
          <aside className="h-fit">
            <Card>
              <h2 className="mb-3 font-display text-xl">Manage</h2>
              <ContactActions
                contactId={c.id}
                archived={Boolean(c.archivedAt)}
                candidates={data.mergeCandidates}
              />
            </Card>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
