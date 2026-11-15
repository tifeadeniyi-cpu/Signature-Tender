import Link from 'next/link';
import { FileText, Contact, Layers, PenLine, Search } from 'lucide-react';
import {
  hasPermission,
  listContacts,
  listTemplates,
  searchLibrary,
  type DocumentStatus,
  type RequestStatus,
} from '@st/core';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { StatusBadge } from '@/components/documents/status-badge';
import { DocumentDrawerHost } from '@/components/documents/drawer/document-drawer';
import { documentReference } from '@/lib/document-summary';
import { requireWorkspace } from '@/lib/session';
import { db } from '@/lib/db';
import { studioSettings } from '@/lib/studio';
import { libraryItems } from '@/lib/studio-library';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search' };

const LIMIT = 8;

/**
 * Header search. Each source is queried through its own service, so the usual row-level security
 * and permission checks apply: members only see records their role can open in this workspace.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; selected?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const { user, membership } = await requireWorkspace();
  const ws = membership.workspace.id;
  const actor = { userId: user.id };
  const p = membership.permissions;
  const canDocs = hasPermission(p, 'documents.view_own') || hasPermission(p, 'documents.view_all');
  const studio = await studioSettings().catch(() => null);

  const [docs, contacts, templates, signatures] = q
    ? await Promise.all([
        canDocs ? searchLibrary(db(), actor, ws, { tab: 'all', q }).catch(() => null) : null,
        hasPermission(p, 'contacts.view')
          ? listContacts(db(), actor, ws, { q }).catch(() => null)
          : null,
        hasPermission(p, 'templates.view')
          ? listTemplates(db(), actor, ws, { q }).catch(() => null)
          : null,
        studio?.enabled
          ? libraryItems(user.id)
              .then((items) => items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase())))
              .catch(() => null)
          : null,
      ])
    : [null, null, null, null];

  const total =
    (docs?.rows.length ?? 0) +
    (contacts?.rows.length ?? 0) +
    (templates?.rows.length ?? 0) +
    (signatures?.length ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Search"
        description={
          q ? `Results for “${q}”` : 'Search documents, contacts, templates and signatures.'
        }
      />
      {!q ? (
        <EmptyState icon={<Search className="size-5" />} title="Type in the search box above">
          Search by document title or reference, contact name or email, template name, or signature
          name.
        </EmptyState>
      ) : total === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="No matches">
          Nothing you can access matches “{q}”. Try a shorter word or check the spelling.
        </EmptyState>
      ) : null}

      {docs && docs.rows.length ? (
        <Section
          icon={<FileText />}
          title="Documents"
          more={`/app/documents?q=${encodeURIComponent(q)}`}
        >
          <DocumentDrawerHost initialId={sp.selected ?? null}>
            <ul className="divide-y divide-border">
              {docs.rows.slice(0, LIMIT).map((d) => (
                <li key={d.id} data-doc-id={d.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/app/documents/${d.id}`}
                      data-drawer-open={d.id}
                      aria-haspopup="dialog"
                      className="font-semibold text-heading hover:underline"
                    >
                      {d.title}
                    </Link>
                    <p className="font-mono text-xs">{documentReference(d.id)}</p>
                  </div>
                  <StatusBadge
                    status={d.status as DocumentStatus}
                    requestStatus={d.requestStatus as RequestStatus | null}
                    isTest={d.isTest}
                  />
                </li>
              ))}
            </ul>
          </DocumentDrawerHost>
        </Section>
      ) : null}

      {contacts && contacts.rows.length ? (
        <Section
          icon={<Contact />}
          title="Contacts"
          more={`/app/contacts?q=${encodeURIComponent(q)}`}
        >
          <ul className="divide-y divide-border">
            {contacts.rows.slice(0, LIMIT).map((c) => (
              <li key={c.id} className="py-2.5">
                <Link
                  href={`/app/contacts/${c.id}`}
                  className="font-semibold text-heading hover:underline"
                >
                  {c.name}
                </Link>
                <p className="text-xs">{c.email}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {templates && templates.rows.length ? (
        <Section
          icon={<Layers />}
          title="Templates"
          more={`/app/templates?q=${encodeURIComponent(q)}`}
        >
          <ul className="divide-y divide-border">
            {templates.rows.slice(0, LIMIT).map((t) => (
              <li key={t.id} className="py-2.5">
                <Link
                  href={`/app/templates/${t.id}`}
                  className="font-semibold text-heading hover:underline"
                >
                  {t.title}
                </Link>
                {t.description ? <p className="truncate text-xs">{t.description}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {signatures && signatures.length ? (
        <Section icon={<PenLine />} title="My Signatures" more="/app/signature-studio/library">
          <ul className="divide-y divide-border">
            {signatures.slice(0, LIMIT).map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5">
                <Link
                  href="/app/signature-studio/library"
                  className="font-semibold text-heading hover:underline"
                >
                  {s.name}
                </Link>
                <span className="text-xs">{s.access === 'active' ? 'Purchased' : 'Draft'}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  icon,
  title,
  more,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  more: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-xl text-heading">
          <span className="text-gold [&>svg]:size-5" aria-hidden>
            {icon}
          </span>
          {title}
        </h2>
        <Link href={more} className="text-sm font-semibold text-primary hover:underline">
          See all
        </Link>
      </div>
      {children}
    </Card>
  );
}
