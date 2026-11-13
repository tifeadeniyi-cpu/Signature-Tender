'use client';
import { useState, useTransition } from 'react';
import { ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { formatSigningTime, layoutSignatureBlock } from '@st/core/signature-block/layout';
import type { SealField, SealInfo } from '@st/core/signature-seals';
import { Button } from '@/components/ui/button';
import { VerificationSeal } from './signature-block';
import { SIGNATURE_BRAND_STYLE } from './brand';

type PageSize = { width: number; height: number };

export type IntegrityResult = {
  ok: boolean;
  message?: string;
  report?: {
    signed: { ok: boolean } | null;
    certificate: { ok: boolean } | null;
    chain: { ok: boolean; events: number };
  };
};

/**
 * Click targets over the seals burned into a signed PDF. The PDF itself carries the artwork; this
 * only adds a button in the same spot, located with the same shared layout that drew it.
 */
export function SealHotspots({
  info,
  page,
  size,
  points,
  onOpen,
}: {
  info: SealInfo;
  page: number;
  size: PageSize;
  points: PageSize;
  onOpen: (f: SealField) => void;
}) {
  return (
    <>
      {info.fields
        .filter((f) => f.page === page)
        .map((f) => {
          const layout = layoutSignatureBlock({
            width: f.width * points.width,
            height: f.height * points.height,
            format: info.format,
            name: f.signerName,
            role: f.role,
            timestamp: { state: 'completed', signedAt: f.signedAt, timeZone: info.timeZone },
          });
          const box = layout.sealBox;
          if (!box) return null;
          const k = size.width / points.width;
          // A comfortable touch target centred on the seal, even when the seal itself is tiny.
          const hit = Math.max(24, box.size * k);
          const cx = (f.x * points.width + box.x + box.size / 2) * k;
          const cy = (f.y * points.height + box.y + box.size / 2) * k;
          return (
            <button
              key={f.fieldId}
              type="button"
              data-seal-hotspot={f.fieldId}
              aria-label={`Signing details for ${f.signerName}`}
              title="Signing details"
              onClick={() => onOpen(f)}
              className="absolute rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              style={{ left: cx - hit / 2, top: cy - hit / 2, width: hit, height: hit }}
            />
          );
        })}
    </>
  );
}

export function VerificationPanel({
  info,
  field,
  onClose,
  checkIntegrity,
}: {
  info: SealInfo;
  field: SealField;
  onClose: () => void;
  checkIntegrity?: (requestId: string) => Promise<IntegrityResult>;
}) {
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [pending, start] = useTransition();
  const intact =
    result?.ok &&
    result.report &&
    result.report.chain.ok &&
    result.report.signed?.ok !== false &&
    result.report.certificate?.ok !== false;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-heading/40 sm:items-center sm:p-4"
      style={SIGNATURE_BRAND_STYLE}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="seal-panel-title"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-card sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <VerificationSeal size={32} />
          <div className="min-w-0 flex-1">
            <h2 id="seal-panel-title" className="font-display text-xl">
              Signing recorded
            </h2>
            <p className="text-xs">Signature Tender evidence is available for this signature.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 hover:bg-blush"
            autoFocus
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt>Signer</dt>
          <dd className="text-heading">
            {field.signerName}
            {field.role ? <span className="text-slate-500"> | {field.role}</span> : null}
          </dd>
          <dt>Signed</dt>
          <dd className="text-heading">
            {formatSigningTime(field.signedAt, info.timeZone).replace(/^Signed on /, '')}
            <span className="block text-xs text-slate-500">
              {field.signedAt.replace('T', ' ').slice(0, 19)} UTC
            </span>
          </dd>
          <dt>Request ID</dt>
          <dd className="break-all font-mono text-xs text-heading">{info.requestId}</dd>
          <dt>Signing event</dt>
          <dd className="break-all font-mono text-xs text-heading">{field.eventRef ?? '—'}</dd>
          <dt>Integrity</dt>
          <dd className="text-heading">
            {result ? (
              intact ? (
                <span className="flex items-center gap-1 text-success">
                  <ShieldCheck className="size-4" aria-hidden /> Signed copy and evidence chain
                  match their records
                  {result.report ? ` (${result.report.chain.events} events)` : ''}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-error">
                  <ShieldAlert className="size-4" aria-hidden />
                  {result.message ?? 'A stored file or the evidence chain did not match.'}
                </span>
              )
            ) : checkIntegrity ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={pending}
                onClick={() => start(async () => setResult(await checkIntegrity(info.requestId)))}
              >
                Check now
              </Button>
            ) : (
              '—'
            )}
          </dd>
        </dl>
        <a
          href={`/api/requests/${info.requestId}/file?kind=certificate`}
          className="mt-4 inline-block text-sm font-semibold text-primary underline"
        >
          Open the completion certificate
        </a>
        <p className="mt-4 text-xs">
          The seal shows that Signature Tender recorded this signing event. It is not a
          cryptographic signature and does not mean the signer&apos;s identity was independently
          verified.
        </p>
      </div>
    </div>
  );
}
