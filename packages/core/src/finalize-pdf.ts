import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { REVERSED_LOGO_PNG_BASE64 } from './brand-logo.generated';

export interface StampField {
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
  imagePng: Uint8Array | null;
}

const INK = rgb(0.06, 0.09, 0.2);
/** Midnight Navy and Champagne Gold. Only new certificates use these; stored PDFs never change. */
const NAVY = rgb(0.051, 0.106, 0.2);
const GOLD = rgb(0.847, 0.686, 0.408);
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
  const pages = pdf.getPages();
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) throw new Error(`Field on missing page ${f.page}`);
    const b = box(page, f);
    if ((f.type === 'signature' || f.type === 'initials') && f.imagePng) {
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

export interface CertificateData {
  requestId: string;
  isTest: boolean;
  title: string;
  workspaceName: string;
  senderName: string;
  senderEmail: string;
  sentAt: Date;
  completedAt: Date;
  sourceSha256: string;
  signedSha256: string;
  pageCount: number;
  signingOrderEnabled: boolean;
  disclosureVersion: string;
  recipients: {
    name: string;
    email: string;
    role: string;
    signingOrder: number;
    authMethod: string;
    authenticatedAt: Date | null;
    consentedAt: Date | null;
    signedAt: Date | null;
    ip: string | null;
    userAgent: string | null;
    signatures: { kind: string; method: string; imagePng: Uint8Array }[];
  }[];
  events: { at: Date; type: string; who: string; detail: string }[];
  chainHead: string;
}

const iso = (d: Date | null) => (d ? `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC` : '-');

/** Builds the completion certificate: a record of what Signature Tender captured during signing. */
export async function buildCertificate(c: CertificateData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 50;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const ensure = (need: number) => {
    if (y - need < M + 20) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const clip = (s: string, f: PDFFont, size: number, max: number) => {
    let t = s.replace(/[^\x20-\x7E]/g, '?');
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -1);
    return t;
  };
  const line = (label: string, value: string, opts: { size?: number } = {}) => {
    const size = opts.size ?? 9;
    ensure(size + 6);
    page.drawText(label, { x: M, y, size, font: bold, color: MUTED });
    page.drawText(clip(value, font, size, W - M - 190), { x: M + 140, y, size, font, color: INK });
    y -= size + 6;
  };
  const heading = (t: string, keepWith = 30) => {
    ensure(keepWith);
    y -= 8;
    page.drawText(t, { x: M, y, size: 13, font: bold, color: NAVY });
    y -= 8;
    page.drawLine({
      start: { x: M, y },
      end: { x: W - M, y },
      thickness: 0.5,
      color: rgb(0.906, 0.882, 0.839),
    });
    y -= 14;
  };

  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: NAVY });
  page.drawRectangle({ x: 0, y: H - 72, width: W, height: 2, color: GOLD });
  const logo = await pdf.embedPng(Buffer.from(REVERSED_LOGO_PNG_BASE64, 'base64'));
  const logoH = 52;
  page.drawImage(logo, {
    x: M - 6,
    y: H - 70 + (70 - logoH) / 2,
    width: (logo.width / logo.height) * logoH,
    height: logoH,
  });
  page.drawText('Completion Certificate', {
    x: W - M - bold.widthOfTextAtSize('Completion Certificate', 13),
    y: H - 40,
    size: 13,
    font: bold,
    color: rgb(1, 1, 1),
  });
  y = H - 100;
  if (c.isTest) {
    page.drawRectangle({
      x: M,
      y: y - 6,
      width: W - 2 * M,
      height: 22,
      color: rgb(0.996, 0.886, 0.886),
    });
    page.drawText('TEST REQUEST: sent in a test environment. Not for real use.', {
      x: M + 8,
      y,
      size: 10,
      font: bold,
      color: rgb(0.73, 0.11, 0.11),
    });
    y -= 30;
  }

  heading('Agreement');
  line('Document', c.title);
  line('Reference', c.requestId);
  line('Workspace', c.workspaceName);
  line('Sender', `${c.senderName} <${c.senderEmail}>`);
  line('Sent', iso(c.sentAt));
  line('Completed', iso(c.completedAt));
  line('Pages', String(c.pageCount));
  line('Signing order', c.signingOrderEnabled ? 'Sequential' : 'Any order');
  line('Disclosure version', c.disclosureVersion);

  heading('Document integrity (SHA-256)');
  line('Original', c.sourceSha256, { size: 8 });
  line('Signed copy', c.signedSha256, { size: 8 });
  line('Evidence chain', c.chainHead, { size: 8 });

  heading('Recipients', 140);
  for (const r of c.recipients) {
    ensure(120);
    page.drawText(
      clip(`${c.signingOrderEnabled ? `${r.signingOrder}. ` : ''}${r.name}`, bold, 11, W - 2 * M),
      { x: M, y, size: 11, font: bold, color: INK },
    );
    y -= 15;
    line('Email', r.email);
    line('Role', r.role);
    line(
      'Verification',
      r.authMethod === 'email_code' ? 'Email link and one-time email code' : 'Email link',
    );
    if (r.authenticatedAt) line('Code verified', iso(r.authenticatedAt));
    line('Consented', iso(r.consentedAt));
    line('Completed', iso(r.signedAt));
    line('IP address', r.ip ?? '-');
    line('Browser', r.userAgent ?? '-', { size: 7 });
    for (const s of r.signatures) {
      ensure(50);
      const img = await pdf.embedPng(s.imagePng);
      const scale = Math.min(160 / img.width, 40 / img.height);
      page.drawText(`${s.kind === 'initials' ? 'Initials' : 'Signature'} (${s.method})`, {
        x: M,
        y: y - 4,
        size: 8,
        font: bold,
        color: MUTED,
      });
      page.drawImage(img, {
        x: M + 140,
        y: y - 34,
        width: img.width * scale,
        height: img.height * scale,
      });
      y -= 46;
    }
    y -= 6;
  }

  heading('Event history', 60);
  for (const e of c.events) {
    ensure(14);
    page.drawText(iso(e.at), { x: M, y, size: 7.5, font, color: MUTED });
    page.drawText(
      clip(`${e.type}  ${e.who}${e.detail ? `  ${e.detail}` : ''}`, font, 7.5, W - M - 160),
      { x: M + 110, y, size: 7.5, font, color: INK },
    );
    y -= 12;
  }

  heading('About this certificate', 90);
  const notes = [
    'This certificate records the events Signature Tender captured while this document was signed.',
    'Recipient identities are as entered by the sender and confirmed only by access to the email address',
    'shown (and a one-time code where listed). Signature Tender did not independently verify identity.',
    'Whether an electronic signature is enforceable depends on the document, the parties and the law that applies.',
  ];
  for (const n of notes) {
    ensure(12);
    page.drawText(n, { x: M, y, size: 8, font, color: MUTED });
    y -= 12;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Reference ${c.requestId}  |  Page ${i + 1} of ${pages.length}`, {
      x: M,
      y: 24,
      size: 7,
      font,
      color: MUTED,
    }),
  );
  pdf.setTitle(`Completion certificate: ${c.title}`);
  pdf.setProducer('Signature Tender');
  return pdf.save({ useObjectStreams: false });
}
