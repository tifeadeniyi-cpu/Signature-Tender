'use client';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormStatus } from '@/components/ui/form-status';
import { logoAction, saveBrandingAction } from '../actions';

const DEFAULT = '#5b0a1c';

/** WCAG contrast of white text on a colour; mirrors the server check. */
function contrast(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0;
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  return 1.05 / (l + 0.05);
}

export function BrandingForm({
  disabled,
  workspaceName,
  initial,
}: {
  disabled: boolean;
  workspaceName: string;
  initial: { brandName: string; color: string | null };
}) {
  const [state, act, pending] = useActionState(saveBrandingAction, null);
  const [name, setName] = useState(initial.brandName);
  const [useColor, setUseColor] = useState(Boolean(initial.color));
  const [color, setColor] = useState(initial.color ?? DEFAULT);
  const ratio = contrast(color);
  const shown = useColor ? color : DEFAULT;
  return (
    <form action={act} aria-label="Branding" className="grid gap-6 lg:grid-cols-2">
      <fieldset disabled={disabled || pending} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          Name shown to recipients
          <input
            name="brandName"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={workspaceName}
            className="h-10 rounded-lg border border-border bg-white px-3 font-normal"
          />
          <span className="text-xs font-normal">Leave empty to use the workspace name.</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-heading">
          <input
            type="checkbox"
            name="useColor"
            checked={useColor}
            onChange={(e) => setUseColor(e.target.checked)}
            className="size-4"
          />
          Use a custom accent colour
        </label>
        {useColor ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-heading">
              Accent colour
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 rounded-lg border border-border"
                aria-label="Pick colour"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-heading">
              Hex
              <input
                name="brandColor"
                value={color}
                onChange={(e) => setColor(e.target.value.trim())}
                pattern="#[0-9a-fA-F]{6}"
                className="h-10 w-32 rounded-lg border border-border bg-white px-3 font-mono font-normal"
              />
            </label>
            <p className={ratio >= 4.5 ? 'text-xs' : 'text-xs text-error'}>
              Contrast with white text: {ratio.toFixed(1)}:1{' '}
              {ratio >= 4.5 ? '(meets 4.5:1)' : '(needs 4.5:1, choose a darker shade)'}
            </p>
          </div>
        ) : null}
        <FormStatus state={state} />
        {disabled ? null : (
          <Button type="submit" className="self-start" loading={pending}>
            Save branding
          </Button>
        )}
      </fieldset>
      <div
        aria-label="Email preview"
        className="overflow-hidden rounded-xl border border-border bg-white text-sm"
      >
        <div className="px-5 py-4 font-display text-lg text-white" style={{ background: shown }}>
          {name.trim() || workspaceName}
          <span className="ml-1 font-sans text-xs opacity-85">via Signature Tender</span>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <p className="font-semibold text-heading">Please review and sign</p>
          <span
            className="self-start rounded-lg px-4 py-2 font-semibold text-white"
            style={{ background: shown }}
          >
            Review and sign
          </span>
          <p className="text-xs">
            Legal disclosures, security codes and the signing page controls always keep Signature
            Tender&apos;s standard styling.
          </p>
        </div>
      </div>
    </form>
  );
}

export function LogoForm({
  disabled,
  hasLogo,
  logoSrc,
}: {
  disabled: boolean;
  hasLogo: boolean;
  logoSrc: string | null;
}) {
  const [state, act, pending] = useActionState(logoAction, null);
  return (
    <div className="flex flex-col gap-3">
      {hasLogo && logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt="Current logo"
          className="h-16 max-w-56 self-start rounded border border-border bg-white object-contain p-1"
        />
      ) : (
        <p className="text-sm">No logo uploaded.</p>
      )}
      {disabled ? null : (
        <>
          <form action={act} aria-label="Upload logo" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-heading">
              Logo (PNG or JPEG, up to 512 KB)
              <input
                name="logo"
                type="file"
                accept="image/png,image/jpeg"
                required
                className="text-sm font-normal"
              />
            </label>
            <Button type="submit" variant="secondary" loading={pending}>
              Upload logo
            </Button>
          </form>
          {hasLogo ? (
            <form action={act}>
              <input type="hidden" name="intent" value="remove" />
              <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                Remove logo
              </Button>
            </form>
          ) : null}
        </>
      )}
      <FormStatus state={state} />
    </div>
  );
}
