import { DOCUMENT_TYPES } from '@st/core';
import { loadPreparation } from '@/lib/documents';
import { PrepareHeader } from '@/components/documents/prepare-header';
import { Card, CardHeader } from '@/components/ui/card';
import { PdfPages } from '@/components/documents/pdf-pages';
import { saveDetailsAction } from '../../../actions';
import { DetailsForm } from './details-form';

export const metadata = { title: 'Document details' };

export default async function DocumentStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadPreparation(id);
  const { document: doc, file } = data;
  return (
    <>
      <PrepareHeader
        documentId={id}
        title={doc.title}
        status={doc.status}
        step="document"
        canEdit={data.canEdit}
      />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit">
          <CardHeader title="Details" />
          <DetailsForm
            action={saveDetailsAction.bind(null, id)}
            title={doc.title}
            documentType={doc.documentType ?? ''}
            types={DOCUMENT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            disabled={!data.canEdit}
            nextHref={`/app/documents/${id}/prepare/signers`}
          />
          {file ? (
            <dl className="mt-6 grid grid-cols-2 gap-2 border-t border-border pt-4 text-xs">
              <dt>File</dt>
              <dd className="truncate text-heading">{file.originalFilename}</dd>
              <dt>Pages</dt>
              <dd className="text-heading">{file.pageCount}</dd>
              <dt>Size</dt>
              <dd className="text-heading">{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB</dd>
              <dt>SHA-256</dt>
              <dd className="truncate font-mono text-heading" title={file.sha256}>
                {file.sha256.slice(0, 16)}…
              </dd>
            </dl>
          ) : null}
        </Card>
        <div className="min-w-0 rounded-2xl bg-primary-surface/50 p-4 pb-8">
          <PdfPages src={`/api/documents/${id}/file`} />
        </div>
      </div>
    </>
  );
}
