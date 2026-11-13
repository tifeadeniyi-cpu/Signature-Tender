import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  layoutSignatureBlock,
  roleLabel,
  type SignatureDisplayFormat,
} from './signature-block/layout';
import { drawSignatureBlock, embedBlockFonts, fieldSizePt } from './signature-block/pdf';

/** Who signed a signature field and when, as recorded by the server. Drives the signature block. */
export interface StampSigner {
  name: string;
  role: string;
  /** Server time the signing event was recorded. Never taken from the signer's device. */
  signedAt: Date;
  timeZone: string;
  format: SignatureDisplayFormat;
}

export interface StampField {
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
  imagePng: Uint8Array | null;
  /** Present for signature and initials fields: draws the full signature block. */
  signer?: StampSigner | null;
}

const INK = rgb(0.06, 0.09, 0.2);
const MUTED = rgb(0.29, 0.33, 0.39);

function fitText(font: PDFFont, text: string, maxW: number, maxH: number) {
  let size = Math.min(12, maxH * 0.7);
  while (size > 5 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.5;
  return size;
}

/** Converts a field's page fractions into PDF user-space points, honouring the crop box. */
function box(page: PDFPage, f: StampField) {
  const crop = page.getCropBox();
  const w = f.width * crop.width;
  const h = f.height * crop.height;
  return {
    x: crop.x + f.x * crop.width,
    y: crop.y + crop.height - (f.y + f.height) * crop.height,
    w,
    h,
  };
}

/**
 * Draws completed field values and adopted signatures onto a copy of the original PDF. The
 * original bytes are never modified. Test requests are stamped on every page.
 */
export async function buildSignedPdf(
  source: Uint8Array,
  fields: StampField[],
  opts: { isTest: boolean; requestId: string },
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const blockFonts = await embedBlockFonts(pdf);
  const pages = pdf.getPages();
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) throw new Error(`Field on missing page ${f.page}`);
    const b = box(page, f);
    if ((f.type === 'signature' || f.type === 'initials') && f.imagePng && f.signer) {
      const img = await pdf.embedPng(f.imagePng);
      const size = fieldSizePt(page, f);
      const layout = layoutSignatureBlock({
        ...size,
        format: f.signer.format,
        kind: f.type,
        name: f.signer.name,
        role: roleLabel(f.signer.role),
        timestamp: { state: 'completed', signedAt: f.signer.signedAt, timeZone: f.signer.timeZone },
      });
      drawSignatureBlock(page, f, layout, img, blockFonts);
    } else if ((f.type === 'signature' || f.type === 'initials') && f.imagePng) {
      const img = await pdf.embedPng(f.imagePng);
      const scale = Math.min(b.w / img.width, b.h / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, width: w, height: h });
    } else if (f.type === 'checkbox') {
      if (f.value === 'true') {
        const s = Math.min(b.w, b.h);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        page.drawLine({
          start: { x: cx - s * 0.35, y: cy },
          end: { x: cx - s * 0.08, y: cy - s * 0.3 },
          thickness: 1.4,
          color: INK,
        });
        page.drawLine({
          start: { x: cx - s * 0.08, y: cy - s * 0.3 },
          end: { x: cx + s * 0.38, y: cy + s * 0.32 },
          thickness: 1.4,
          color: INK,
        });
      }
    } else if (f.value) {
      const size = fitText(font, f.value, b.w - 2, b.h);
      page.drawText(f.value, {
        x: b.x + 1,
        y: b.y + (b.h - size) / 2 + size * 0.2,
        size,
        font,
        color: INK,
      });
    }
  }
  const footer = opts.isTest
    ? `TEST REQUEST - not for real use - Signature Tender ref ${opts.requestId}`
    : `Signature Tender ref ${opts.requestId}`;
  for (const page of pages) {
    const crop = page.getCropBox();
    page.drawText(footer, {
      x: crop.x + 12,
      y: crop.y + 8,
      size: 6.5,
      font,
      color: opts.isTest ? rgb(0.73, 0.11, 0.11) : MUTED,
    });
  }
  pdf.setProducer('Signature Tender');
  pdf.setModificationDate(new Date());
  return pdf.save({ useObjectStreams: false });
}
