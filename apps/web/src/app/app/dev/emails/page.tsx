import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { emailConfig } from '@/lib/email/config';
import { previewImageSrc } from '@/lib/email/design';
import { renderDocumentCompleted } from '@/lib/email/templates/document-completed';
import {
  SAMPLE_VARIANTS,
  VARIANT_LABEL,
  samplePayload,
  type SampleVariant,
} from '@/lib/email/samples';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { SendTestButton } from './send-test';

export const metadata = { title: 'Email previews' };
export const dynamic = 'force-dynamic';

/**
 * Preview of transactional emails with fictional data, at desktop and phone widths, plus a test
 * send to your own inbox for checking Gmail, Outlook and Apple Mail.
 */
export default async function EmailPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string; width?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const variant: SampleVariant = SAMPLE_VARIANTS.includes(sp.variant as SampleVariant)
    ? (sp.variant as SampleVariant)
    : 'recipient';
  const mobile = sp.width === 'mobile';
  const cfg = await emailConfig();
  const sample = `${cfg.appUrl}/retrieve`;
  const r = renderDocumentCompleted({
    payload: samplePayload(variant),
    audience: variant === 'sender' ? 'sender' : 'recipient',
    links: { download: sample, view: sample, evidence: sample },
    linkExpiresAt: new Date('2026-12-09T00:00:00Z'),
    config: cfg,
    imageSrc: previewImageSrc,
  });
  const href = (v: SampleVariant, w: 'desktop' | 'mobile') =>
    `/app/dev/emails?variant=${v}&width=${w}`;
  const pill = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-sm',
      active ? 'border-primary bg-primary text-white' : 'border-border bg-white hover:text-heading',
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Email previews"
        description="Document Successfully Completed email, with sample data only."
      />
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Version">
          {SAMPLE_VARIANTS.map((v) => (
            <Link
              key={v}
              href={href(v, mobile ? 'mobile' : 'desktop')}
              className={pill(v === variant)}
            >
              {VARIANT_LABEL[v]}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2" aria-label="Width">
            <Link href={href(variant, 'desktop')} className={pill(!mobile)}>
              Desktop
            </Link>
            <Link href={href(variant, 'mobile')} className={pill(mobile)}>
              Phone
            </Link>
          </div>
          <SendTestButton variant={variant} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt>Subject</dt>
          <dd className="text-heading">{r.subject}</dd>
          <dt>Preview text</dt>
          <dd className="text-heading">{r.preheader}</dd>
        </dl>
      </Card>
      <div className="flex justify-center overflow-x-auto rounded-xl bg-ivory p-4">
        <iframe
          title="Email preview"
          srcDoc={r.html}
          sandbox=""
          className="rounded-lg border border-border bg-white"
          style={{ width: mobile ? 390 : 700, height: 1900 }}
        />
      </div>
      <details className="rounded-xl border border-border bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-heading">
          Plain-text version
        </summary>
        <pre className="mt-3 whitespace-pre-wrap text-xs">{r.text}</pre>
      </details>
    </div>
  );
}
