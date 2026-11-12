import { DOCUMENT_TYPES, listTemplates, checkTemplate } from '@st/core';
import { db } from '@/lib/db';
import { loadTemplatePage } from '@/lib/templates';
import { Card, CardHeader } from '@/components/ui/card';
import { DetailsForm, ManageTemplate, PublishPanel } from './overview-client';

export const metadata = { title: 'Template' };
const fmt = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export default async function TemplateOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTemplatePage(id);
  const t = data.template;
  const { categories } = await listTemplates(db(), { userId: data.user.id }, t.workspaceId);
  const issues = data.draft ? checkTemplate(data.draft) : [];
  const editable = data.canEdit && t.status !== 'archived';
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Details" />
          <DetailsForm
            templateId={id}
            disabled={!editable}
            categories={categories}
            types={DOCUMENT_TYPES.map((d) => ({ value: d.value, label: d.label }))}
            initial={{
              title: t.title,
              description: t.description,
              category: t.category,
              documentType: t.documentType,
              shared: t.shared,
            }}
          />
        </Card>
        <Card>
          <CardHeader
            title="Contents"
            description={
              data.draft ? 'The unpublished version you are editing.' : 'The published version.'
            }
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt>File</dt>
            <dd className="text-heading">
              <a
                href={`/api/templates/${id}/file`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {data.working.originalFilename}
              </a>{' '}
              ({data.working.pageCount} {data.working.pageCount === 1 ? 'page' : 'pages'})
            </dd>
            <dt>Roles</dt>
            <dd className="text-heading">
              {data.working.recipients.map((r) => r.label).join(', ') || 'None yet'}
            </dd>
            <dt>Fields</dt>
            <dd className="text-heading">{data.working.fields.length}</dd>
            <dt>Signing order</dt>
            <dd className="text-heading">
              {data.working.signingOrderEnabled ? 'In order' : 'Any order'}
            </dd>
            <dt>Owner</dt>
            <dd className="text-heading">{data.ownerName ?? 'Unknown'}</dd>
          </dl>
        </Card>
        <Card>
          <CardHeader
            title="Version history"
            description="Documents keep the version they were created from. Published versions never change."
          />
          {data.history.length === 0 ? (
            <p className="text-sm">Nothing published yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Published versions</caption>
              <thead className="text-xs uppercase tracking-wide text-heading">
                <tr>
                  <th scope="col" className="py-2">
                    Version
                  </th>
                  <th scope="col" className="py-2">
                    Published
                  </th>
                  <th scope="col" className="py-2">
                    Documents created
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">File</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.history.map((v) => (
                  <tr key={v.id}>
                    <td className="py-2 font-medium text-heading">v{v.version}</td>
                    <td className="py-2">{fmt.format(v.publishedAt)} UTC</td>
                    <td className="py-2">{v.uses}</td>
                    <td className="py-2 text-right">
                      <a
                        href={`/api/templates/${id}/file?version=${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        View PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <aside className="flex h-fit flex-col gap-6">
        {editable && data.draft ? (
          <Card>
            <h2 className="mb-2 font-display text-xl">Publish</h2>
            <PublishPanel
              templateId={id}
              issues={issues}
              canDiscard={Boolean(t.publishedVersion)}
            />
          </Card>
        ) : null}
        <Card>
          <h2 className="mb-3 font-display text-xl">Manage</h2>
          <ManageTemplate templateId={id} status={t.status} canEdit={data.canEdit} />
        </Card>
      </aside>
    </div>
  );
}
