import type { CSSProperties, ReactNode } from 'react';
import {
  formatSigningTime,
  layoutSignatureBlock,
  type BlockLayout,
  type BlockTimestamp,
  type Primitive,
  type SignatureDisplayFormat,
} from '@st/core/signature-block/layout';
import {
  CALENDAR_ICON,
  ICON_BOX,
  SEAL_BOX,
  sealLayers,
  type SealLayer,
  type SealVariant,
} from '@st/core/signature-block/seal';

/**
 * The Signature Tender signature block on screen. It renders the shared layout from @st/core as
 * SVG in PDF points, so it scales with the page at any zoom and matches the signed PDF exactly.
 *
 * Use `timestamp={{ state: 'pending' }}` while signing: no time and no seal are shown until the
 * server has recorded the signing event and returned its time.
 */
export interface SignatureBlockProps {
  /** Field size in PDF points (field fraction x page size in points). */
  widthPt: number;
  heightPt: number;
  /** The adopted signature image (data URL or authorized URL). */
  imageSrc: string;
  name: string;
  /** Display label such as "Signer"; use roleLabel() from @st/core/signature-block/layout. */
  role?: string | null;
  format?: SignatureDisplayFormat;
  kind?: 'signature' | 'initials';
  timestamp: BlockTimestamp;
  className?: string;
  style?: CSSProperties;
  /** Optional overlay drawn inside the seal box (for example a click target). */
  sealSlot?: (box: NonNullable<BlockLayout['sealBox']>, layout: BlockLayout) => ReactNode;
}

const FONT_FAMILY = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serifBold: '"Times New Roman", Times, "Liberation Serif", serif',
} as const;

function Layers({ layers }: { layers: SealLayer[] }) {
  return (
    <>
      {layers.map((l, i) => (
        <path
          key={i}
          d={l.d}
          fill={l.fill ?? 'none'}
          stroke={l.stroke ?? 'none'}
          strokeWidth={l.stroke ? (l.strokeWidth ?? 1) : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}

function renderPrimitive(p: Primitive, i: number, imageSrc: string) {
  switch (p.kind) {
    case 'image':
      return p.width > 0 && p.height > 0 ? (
        <image
          key={i}
          data-part="signature"
          href={imageSrc}
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          preserveAspectRatio={p.align === 'center' ? 'xMidYMid meet' : 'xMinYMax meet'}
        />
      ) : null;
    case 'line':
      return (
        <line
          key={i}
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          stroke={p.color}
          strokeWidth={p.thickness}
        />
      );
    case 'rect':
      return (
        <rect
          key={i}
          data-part="timestamp-strip"
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          rx={p.radius}
          fill={p.color}
        />
      );
    case 'text':
      return (
        <text
          key={i}
          x={p.x}
          y={p.y}
          fontSize={p.size}
          fontFamily={FONT_FAMILY[p.font]}
          fontWeight={p.font === 'serifBold' ? 700 : 400}
          fill={p.color}
          textLength={p.width}
          lengthAdjust="spacingAndGlyphs"
        >
          {p.text}
        </text>
      );
    case 'icon':
      return (
        <g key={i} transform={`translate(${p.x} ${p.y}) scale(${p.size / ICON_BOX})`}>
          <Layers layers={CALENDAR_ICON} />
        </g>
      );
    case 'seal':
      return (
        <g
          key={i}
          data-part="seal"
          data-variant={p.variant}
          transform={`translate(${p.x} ${p.y}) scale(${p.size / SEAL_BOX})`}
        >
          <Layers layers={sealLayers(p.variant)} />
        </g>
      );
  }
}

export function SignatureBlock(props: SignatureBlockProps) {
  const layout = layoutSignatureBlock({
    width: props.widthPt,
    height: props.heightPt,
    format: props.format,
    kind: props.kind,
    name: props.name,
    role: props.role,
    timestamp: props.timestamp,
  });
  const { width: W, height: H } = layout;
  const ts = props.timestamp;
  const label = [
    `${props.kind === 'initials' ? 'Initials' : 'Signature'} of ${props.name}`,
    ts.state === 'pending' ? 'signing time pending' : formatSigningTime(ts.signedAt, ts.timeZone),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div
      className={props.className}
      style={{ position: 'relative', width: '100%', height: '100%', ...props.style }}
      data-signature-block={layout.format}
      data-state={props.timestamp.state}
      data-fits={layout.fits ? 'true' : 'false'}
    >
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {layout.primitives.map((p, i) => renderPrimitive(p, i, props.imageSrc))}
      </svg>
      {layout.sealBox && props.sealSlot ? (
        <div
          style={{
            position: 'absolute',
            left: `${(layout.sealBox.x / W) * 100}%`,
            top: `${(layout.sealBox.y / H) * 100}%`,
            width: `${(layout.sealBox.size / W) * 100}%`,
            height: `${(layout.sealBox.size / H) * 100}%`,
          }}
        >
          {props.sealSlot(layout.sealBox, layout)}
        </div>
      ) : null}
    </div>
  );
}

/** The seal on its own, for use as a small icon (24-32px recommended). */
export function VerificationSeal({
  size = 28,
  variant,
  title = 'Signing recorded by Signature Tender',
  className,
}: {
  size?: number;
  variant?: SealVariant;
  title?: string;
  className?: string;
}) {
  const v = variant ?? (size >= 18 ? 'full' : 'simple');
  return (
    <svg
      viewBox={`0 0 ${SEAL_BOX} ${SEAL_BOX}`}
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <Layers layers={sealLayers(v)} />
    </svg>
  );
}
