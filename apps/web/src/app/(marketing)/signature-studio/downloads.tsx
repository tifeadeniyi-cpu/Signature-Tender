'use client';
import { useState } from 'react';
import { Download, FileArchive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { studioDownloadLinkAction } from './actions';

const LABEL = { png: 'Download Transparent PNG', svg: 'Download SVG', jpeg: 'Download JPG', zip: 'Download All Formats' } as const;
const BGS = [
  ['white', 'White', '#FFFFFF'],
  ['ivory', 'Warm ivory', '#FFF9F2'],
  ['cream', 'Cream', '#F6F0E7'],
] as const;

/** Each click asks the server for a fresh, short-lived link tied to this signed-in owner. */
export function DownloadButtons({ designId, formats }: { designId: string; formats: ('png' | 'svg' | 'jpeg')[] }) {
  const [bg, setBg] = useState<(typeof BGS)[number][0]>('white');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function go(f: keyof typeof LABEL) {
    setBusy(f);
    setError('');
    const r = await studioDownloadLinkAction(designId, f, bg);
    setBusy(null);
    if (!r.ok) return setError(r.message);
    window.location.assign(r.url);
  }
  return (
    <div className="flex flex-col gap-3">
      {formats.map((f) => (
        <Button key={f} type="button" size="lg" variant={f === 'png' ? 'primary' : 'secondary'} loading={busy === f} onClick={() => void go(f)} className="w-full justify-start">
          <Download className="size-4" aria-hidden /> {LABEL[f]}
        </Button>
      ))}
      {formats.length > 1 ? (
        <Button type="button" size="lg" variant="secondary" loading={busy === 'zip'} onClick={() => void go('zip')} className="w-full justify-start">
          <FileArchive className="size-4" aria-hidden /> {LABEL.zip}
        </Button>
      ) : null}
      {formats.includes('jpeg') ? (
        <fieldset className="mt-1">
          <legend className="text-xs font-semibold text-heading">JPG background</legend>
          <div className="mt-1 flex gap-2">
            {BGS.map(([id, label, color]) => (
              <label key={id} className={cn('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs', bg === id ? 'border-primary' : 'border-border')}>
                <input type="radio" name="jpeg-bg" value={id} checked={bg === id} onChange={() => setBg(id)} className="sr-only" />
                <span className="size-4 rounded-full border border-border" style={{ background: color }} aria-hidden />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
    </div>
  );
}
