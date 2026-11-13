'use client';
import { useActionState } from 'react';
import { ELEMENT_TYPES, PENS, STUDIO_FONTS, STUDIO_INKS, type StudioSettings } from '@st/core/studio/index';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { saveStudioSettingsAction } from './actions';

function Check({ name, label, checked, value }: { name: string; label: string; checked: boolean; value?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value ?? 'on'} defaultChecked={checked} className="size-4 accent-[#0D1B33]" />
      {label}
    </label>
  );
}

function Num({ name, label, value, step = 1, min, max, hint }: { name: string; label: string; value: number; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-heading">{label}</span>
      <input type="number" name={name} defaultValue={value} step={step} min={min} max={max} className="h-10 rounded-lg border border-border px-3" />
      {hint ? <span className="text-xs text-slate-text">{hint}</span> : null}
    </label>
  );
}

export function StudioSettingsForm({ settings }: { settings: StudioSettings }) {
  const [state, action, pending] = useActionState(saveStudioSettingsAction, null);
  return (
    <form action={action} className="flex flex-col gap-6">
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-heading">Availability</legend>
        <Check name="enabled" label="Signature Studio visible" checked={settings.enabled} />
        <Check name="freePreview" label="Free preview without an account" checked={settings.freePreview} />
        <Check name="purchasesEnabled" label="New purchases allowed" checked={settings.purchasesEnabled} />
        <Check name="initialsEnabled" label="Initials designer" checked={settings.initialsEnabled} />
        <Check name="crossSell" label="Show Signature Tender cross-sell" checked={settings.crossSell} />
        <Check name="customInk" label="Allow custom ink colors" checked={settings.customInk} />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-heading">Price and files</legend>
        <Num name="price" label="Price per design (USD)" value={settings.priceCents / 100} step={0.01} min={0.5} max={100} hint="Applies to new checkouts only." />
        <Num name="exportWidth" label="PNG and JPG width (px)" value={settings.exportWidth} min={800} max={4000} />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-heading">Download formats</span>
          <Check name="fmt_png" label="Transparent PNG" checked={settings.formats.png} />
          <Check name="fmt_svg" label="SVG (Studio-made designs only)" checked={settings.formats.svg} />
          <Check name="fmt_jpeg" label="JPG" checked={settings.formats.jpeg} />
        </div>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-heading">Retention and links</legend>
        <Num name="retentionDays" label="Downloads available for (days)" value={settings.retentionDays} min={0} hint="0 means for as long as the account exists." />
        <Num name="guestDraftDays" label="Delete guest drafts after (days)" value={settings.guestDraftDays} min={1} max={90} />
        <Num name="downloadLinkSeconds" label="Download link expiry (seconds)" value={settings.downloadLinkSeconds} min={30} max={3600} />
      </fieldset>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-heading">Promotional message (shown above the editor)</span>
        <input name="promoMessage" defaultValue={settings.promoMessage} maxLength={240} className="h-10 rounded-lg border border-border px-3" />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-heading">Ink colors offered</legend>
        <div className="flex flex-wrap gap-3">
          {STUDIO_INKS.map((i) => (
            <Check key={i.color} name="inks" value={i.color} label={i.label} checked={settings.inks.map((c) => c.toUpperCase()).includes(i.color.toUpperCase())} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-heading">Pens switched off</legend>
        <div className="flex flex-wrap gap-3">
          {PENS.map((p) => (
            <Check key={p.id} name="disabledPens" value={p.id} label={p.label} checked={settings.disabledPens.includes(p.id)} />
          ))}
        </div>
      </fieldset>
      <details>
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-heading">Elements switched off</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {ELEMENT_TYPES.map((e) => (
            <Check key={e.id} name="disabledElements" value={e.id} label={e.label} checked={settings.disabledElements.includes(e.id)} />
          ))}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-heading">Fonts: featured and switched off</summary>
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Fonts">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Font</th>
                <th>Category</th>
                <th>Licence</th>
                <th>Featured</th>
                <th>Switched off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {STUDIO_FONTS.map((f) => (
                <tr key={f.id}>
                  <td className="py-1.5">{f.name}</td>
                  <td>{f.category}</td>
                  <td>
                    <a href={`/studio-fonts/licenses/${f.id}.txt`} className="text-primary underline" target="_blank" rel="noreferrer">
                      {f.license}
                    </a>
                  </td>
                  <td>
                    <input type="checkbox" name="featuredFonts" value={f.id} defaultChecked={settings.featuredFonts.includes(f.id)} aria-label={`Feature ${f.name}`} className="size-4 accent-[#0D1B33]" />
                  </td>
                  <td>
                    <input type="checkbox" name="disabledFonts" value={f.id} defaultChecked={settings.disabledFonts.includes(f.id)} aria-label={`Switch off ${f.name}`} className="size-4 accent-[#0D1B33]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {state ? <Alert tone={state.ok ? 'success' : 'error'}>{state.message}</Alert> : null}
      <div>
        <Button type="submit" loading={pending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
