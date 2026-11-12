'use client';
import { useMemo } from 'react';
import {
  SIGNATURE_DISPLAY_FORMATS,
  SIGNATURE_DISPLAY_LABELS,
  type SignatureDisplayFormat,
} from '@st/core/signature-block/layout';
import { Card, CardHeader } from '@/components/ui/card';
import { SignatureBlock } from './signature-block';

const OPTION_LETTER: Record<SignatureDisplayFormat, string> = {
  signature: 'A',
  signature_name: 'B',
  signature_name_time: 'C',
  full: 'D',
};

/** A sample adopted signature for previews only. Real blocks always use the signer's own mark. */
export const SAMPLE_SIGNATURE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80"><text x="6" y="58" font-family="Snell Roundhand, Segoe Script, Brush Script MT, cursive" font-style="italic" font-size="46" fill="#111">Alex Morgan</text></svg>',
  );

/**
 * Sender's choice of what signature fields show once signed (spec options A-D, D by default), plus
 * the time zone used for signing times. Signers cannot change either.
 */
export function SignatureDisplayCard({
  format,
  timeZone,
  onFormat,
  onTimeZone,
  className,
}: {
  format: SignatureDisplayFormat;
  timeZone: string | null;
  onFormat: (f: SignatureDisplayFormat) => void;
  onTimeZone: (tz: string | null) => void;
  className?: string;
}) {
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);
  const sampleTime = useMemo(() => new Date(Date.UTC(2026, 10, 12, 15, 24)).toISOString(), []);
  return (
    <Card className={className}>
      <CardHeader
        title="Signature block"
        description="What each signature field shows on the signed document. The signing time always comes from Signature Tender's server and is kept in the completion certificate."
      />
      <div
        role="radiogroup"
        aria-label="Signature block format"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {SIGNATURE_DISPLAY_FORMATS.map((f) => (
          <label
            key={f}
            className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-surface"
          >
            <span className="flex items-start gap-2">
              <input
                type="radio"
                name="signatureDisplay"
                className="mt-0.5 size-4"
                checked={format === f}
                onChange={() => onFormat(f)}
              />
              <span className="text-sm font-semibold text-heading">
                {OPTION_LETTER[f]}. {SIGNATURE_DISPLAY_LABELS[f]}
                {f === 'full' ? (
                  <span className="ml-1 text-xs font-normal">(recommended)</span>
                ) : null}
              </span>
            </span>
            <span aria-hidden className="block h-[78px] w-full rounded-lg bg-white p-1">
              <SignatureBlock
                widthPt={230}
                heightPt={78}
                imageSrc={SAMPLE_SIGNATURE}
                name="Alex Morgan"
                role="Signer"
                format={f}
                timestamp={{
                  state: 'completed',
                  signedAt: sampleTime,
                  timeZone: timeZone ?? 'America/New_York',
                }}
              />
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs">
        The seal means Signature Tender recorded the signing event and its evidence is available. It
        does not mean anyone&apos;s identity was independently verified. If a field is too small for
        the format you pick, a shorter version is used and the full details stay in the certificate.
      </p>
      <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-heading">
        Time zone for signing times
        <select
          value={timeZone ?? ''}
          onChange={(e) => onTimeZone(e.target.value || null)}
          className="h-10 max-w-sm rounded-lg border border-border px-2 font-normal"
        >
          <option value="">Use the sender&apos;s profile time zone</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
    </Card>
  );
}
