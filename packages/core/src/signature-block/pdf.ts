/**
 * Draws a signature block layout into a PDF page with pdf-lib. Server only.
 */
import {
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  LineCapStyle,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { BlockLayout } from './layout';
import { CALENDAR_ICON, ICON_BOX, SEAL_BOX, sealLayers, type SealLayer } from './seal';

function hex(c: string) {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export interface BlockFonts {
  sans: PDFFont;
  serifBold: PDFFont;
}

/** Embeds the two standard fonts the block uses. Call once per document. */
export async function embedBlockFonts(pdf: PDFDocument): Promise<BlockFonts> {
  return {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    serifBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
  };
}

function roundedRect(w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  return `M ${k} 0 L ${w - k} 0 Q ${w} 0 ${w} ${k} L ${w} ${h - k} Q ${w} ${h} ${w - k} ${h} L ${k} ${h} Q 0 ${h} 0 ${h - k} L 0 ${k} Q 0 0 ${k} 0 Z`;
}

/**
 * Field rectangle as fractions of the page *as displayed* (viewer orientation, y down), which is
 * how fields are placed. Rotated pages are handled by mapping that frame into PDF user space.
 */
export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Displayed page size in points (rotation applied). */
export function displayedPageSize(page: PDFPage) {
  const crop = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  return rot === 90 || rot === 270
    ? { width: crop.height, height: crop.width }
    : { width: crop.width, height: crop.height };
}

/** Field size in points, in the displayed orientation. */
export function fieldSizePt(page: PDFPage, f: FieldRect) {
  const d = displayedPageSize(page);
  return { width: f.width * d.width, height: f.height * d.height };
}

/**
 * Matrix taking block-local coordinates (origin at the field's displayed bottom-left, x right,
 * y up as displayed) into PDF user space.
 */
function fieldMatrix(
  page: PDFPage,
  f: FieldRect,
): [number, number, number, number, number, number] {
  const crop = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  // Displayed fractions (u right, v down) of the field's bottom-left corner.
  const u = f.x;
  const v = f.y + f.height;
  const { x: cx, y: cy, width: cw, height: ch } = crop;
  switch (rot) {
    case 90:
      return [0, 1, -1, 0, cx + v * cw, cy + u * ch];
    case 180:
      return [-1, 0, 0, -1, cx + cw - u * cw, cy + v * ch];
    case 270:
      return [0, -1, 1, 0, cx + cw - v * cw, cy + ch - u * ch];
    default:
      return [1, 0, 0, 1, cx + u * cw, cy + ch - v * ch];
  }
}

function drawLayers(page: PDFPage, layers: SealLayer[], x: number, topY: number, scale: number) {
  for (const l of layers) {
    page.drawSvgPath(l.d, {
      x,
      y: topY,
      scale,
      color: l.fill ? hex(l.fill) : undefined,
      borderColor: l.stroke ? hex(l.stroke) : undefined,
      borderWidth: l.stroke ? (l.strokeWidth ?? 1) : 0,
      borderLineCap: LineCapStyle.Round,
    });
  }
}

/**
 * Draws `layout` into `field` on `page`. `image` is the adopted signature PNG, embedded unchanged
 * (never re-rasterized), so the PDF keeps the exact mark the signer approved.
 */
export function drawSignatureBlock(
  page: PDFPage,
  field: FieldRect,
  layout: BlockLayout,
  image: PDFImage,
  fonts: BlockFonts,
) {
  drawWithMatrix(page, fieldMatrix(page, field), layout, image, fonts);
}

/** Draws a block with its bottom-left corner at (x, y) in user space, unrotated (certificates). */
export function drawSignatureBlockAt(
  page: PDFPage,
  x: number,
  y: number,
  layout: BlockLayout,
  image: PDFImage,
  fonts: BlockFonts,
) {
  drawWithMatrix(page, [1, 0, 0, 1, x, y], layout, image, fonts);
}

function drawWithMatrix(
  page: PDFPage,
  matrix: [number, number, number, number, number, number],
  layout: BlockLayout,
  image: PDFImage,
  fonts: BlockFonts,
) {
  const H = layout.height;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
  try {
    for (const p of layout.primitives) {
      switch (p.kind) {
        case 'image': {
          if (p.width <= 0 || p.height <= 0) break;
          const scale = Math.min(p.width / image.width, p.height / image.height);
          const w = image.width * scale;
          const h = image.height * scale;
          const x = p.align === 'center' ? p.x + (p.width - w) / 2 : p.x;
          const yTop = p.align === 'center' ? p.y + (p.height - h) / 2 : p.y + p.height - h;
          page.drawImage(image, { x, y: H - yTop - h, width: w, height: h });
          break;
        }
        case 'line':
          page.drawLine({
            start: { x: p.x1, y: H - p.y1 },
            end: { x: p.x2, y: H - p.y2 },
            thickness: p.thickness,
            color: hex(p.color),
          });
          break;
        case 'rect':
          page.drawSvgPath(roundedRect(p.width, p.height, p.radius), {
            x: p.x,
            y: H - p.y,
            color: hex(p.color),
            borderWidth: 0,
          });
          break;
        case 'text':
          page.drawText(p.text, {
            x: p.x,
            y: H - p.y,
            size: p.size,
            font: fonts[p.font],
            color: hex(p.color),
          });
          break;
        case 'icon':
          drawLayers(page, CALENDAR_ICON, p.x, H - p.y, p.size / ICON_BOX);
          break;
        case 'seal':
          drawLayers(page, sealLayers(p.variant), p.x, H - p.y, p.size / SEAL_BOX);
          break;
      }
    }
  } finally {
    page.pushOperators(popGraphicsState());
  }
}
