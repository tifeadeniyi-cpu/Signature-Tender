import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import QRCode from 'qrcode';
import { REVERSED_LOGO_PNG_BASE64 } from './brand-logo.generated';
import { NIB_MARK_PNG_BASE64 } from './brand-nib.generated';

/**
 * Certificate of Completion (Midnight Navy and Champagne Gold). Everything printed here comes
 * from recorded evidence passed in by the caller; this module only lays it out.
 */

export type CertificatePageSize = 'letter' | 'a4';

export interface CertificateSigner {
  name: string;
  email: string;
  roleLabel: string;
  /** Verification actually completed, e.g. "Email invitation link". */
  authLabel: string;
  /** "Typed", "Drawn", "Uploaded", or "—" for approvals and reviews. */
  methodLabel: string;
  doneAt: Date;
  /** "Signed", "Approved" or "Reviewed": the action the person actually took. */
  statusLabel: string;
  /** Reference to this person's recorded completion event, as shown on the document's seals. */
  eventRef?: string | null;
  /** The signer's own time zone when they signed; their row's time is shown in it. */
  timeZone?: string | null;
}

export interface CertificateEvent {
  at: Date;
  text: string;
  final?: boolean;
}

export interface CompletionCertificate {
  pageSize: CertificatePageSize;
  isTest: boolean;
  title: string;
  documentRef: string;
  requestId: string;
  verificationRef: string;
  certificateNumber: string;
  senderName: string;
  organization: string | null;
  createdAt: Date;
  sentAt: Date | null;
  completedAt: Date;
  issuedAt: Date;
  /** Set when this certificate replaces one issued earlier for the same agreement. */
  reissue: { originalIssuedAt: Date; originalSha256: string } | null;
  agreementPages: number;
  timeZone: string;
  signingOrder: boolean;
  signers: CertificateSigner[];
  copyRecipients: number;
  events: CertificateEvent[];
  /** Number of events in the full evidence log, which stays with the sender's records. */
  evidenceEventCount: number;
  hashes: { signed: string; original: string; chainHead: string };
  /** Public page for this reference, e.g. https://example.com/verify?ref=STV-ABCD-EFGH. */
  verifyUrl: string;
}

const NAVY = rgb(13 / 255, 27 / 255, 51 / 255);
const ROYAL = rgb(23 / 255, 45 / 255, 77 / 255);
const GOLD = rgb(216 / 255, 175 / 255, 104 / 255);
const SOFT_GOLD = rgb(243 / 255, 222 / 255, 180 / 255);
const IVORY = rgb(1, 249 / 255, 242 / 255);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(21 / 255, 128 / 255, 61 / 255);
const GREEN_BG = rgb(220 / 255, 252 / 255, 231 / 255);
const SLATE = rgb(71 / 255, 85 / 255, 105 / 255);
const LINE = rgb(231 / 255, 225 / 255, 214 / 255);
const RED = rgb(185 / 255, 28 / 255, 28 / 255);
const RED_BG = rgb(254 / 255, 226 / 255, 226 / 255);

const SIZES: Record<CertificatePageSize, [number, number]> = {
  letter: [612, 792],
  a4: [595.28, 841.89],
};

/** Picks Letter or A4 to match the agreement's first page. */
export function pageSizeFor(width: number, height: number): CertificatePageSize {
  const [w, h] = width > height ? [height, width] : [width, height];
  return Math.abs(w - 595.28) + Math.abs(h - 841.89) < Math.abs(w - 612) + Math.abs(h - 792)
    ? 'a4'
    : 'letter';
}

export function formatCertTime(d: Date, timeZone: string) {
  const tz = safeZone(timeZone);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
  return { date, time, both: `${date} • ${time}` };
}

function safeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

interface Fonts {
  sans: PDFFont;
  sansBold: PDFFont;
  serif: PDFFont;
  serifReg: PDFFont;
  mono: PDFFont;
}

/** Characters the standard fonts cannot encode become "?", so a name never breaks a certificate. */
function clean(f: PDFFont, s: string) {
  let out = '';
  for (const ch of s.replace(/[\r\n\t]+/g, ' ')) {
    try {
      f.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function wrap(f: PDFFont, text: string, size: number, max: number): string[] {
  const words = clean(f, text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const push = (w: string) => {
    // Break a single overlong word (an email or a hash) by characters.
    let rest = w;
    while (f.widthOfTextAtSize(rest, size) > max) {
      let i = rest.length;
      while (i > 1 && f.widthOfTextAtSize(rest.slice(0, i), size) > max) i--;
      lines.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    return rest;
  };
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(next, size) <= max) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = push(w);
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function spaced(s: string) {
  return s.split('').join(' ');
}

function roundedRect(w: number, h: number, r: number) {
  return `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`;
}

/** Draws a rounded rectangle whose top-left corner is (x, top). */
function panel(
  page: PDFPage,
  x: number,
  top: number,
  w: number,
  h: number,
  opts: { fill?: RGB; border?: RGB; r?: number },
) {
  page.drawSvgPath(roundedRect(w, h, opts.r ?? 8), {
    x,
    y: top,
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.border ? 0.7 : 0,
  });
}

function checkMark(page: PDFPage, cx: number, cy: number, r: number, color: RGB = WHITE) {
  const s = r / 6;
  page.drawSvgPath(`M ${-3 * s} 0 L ${-1 * s} ${2.2 * s} L ${3.2 * s} ${-2.4 * s}`, {
    x: cx,
    y: cy,
    borderColor: color,
    borderWidth: Math.max(1, r / 4.5),
  });
}

/** Small gold icons drawn as paths, so they stay crisp in print. */
function icon(page: PDFPage, kind: 'doc' | 'people' | 'timeline' | 'shield', x: number, y: number) {
  const o = { x, y, borderColor: GOLD, borderWidth: 1.1 };
  if (kind === 'doc') {
    page.drawSvgPath(
      'M 1 -1 L 8 -1 L 12 3 L 12 15 L 1 15 Z M 8 -1 L 8 3 L 12 3 M 3.5 7 L 9.5 7 M 3.5 10 L 9.5 10',
      o,
    );
  } else if (kind === 'people') {
    page.drawSvgPath(
      'M 5 2 m -3 0 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0 M 0 14 Q 0 8 5 8 Q 10 8 10 14 M 11 3 a 2.5 2.5 0 1 1 0 5 M 12 9 Q 15 9.5 15 14',
      o,
    );
  } else if (kind === 'timeline') {
    page.drawSvgPath('M 1 13 L 5 8 L 9 10 L 14 3 M 1 15 L 15 15', o);
  } else {
    page.drawSvgPath(
      'M 7 0 L 14 3 L 14 8 Q 14 13 7 16 Q 0 13 0 8 L 0 3 Z M 4 8 L 6.5 10.5 L 10.5 5.5',
      o,
    );
  }
}

/** Version-1+ QR code drawn as vector squares: sharp and scannable when printed. */
function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: WHITE });
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c))
        page.drawRectangle({
          x: x + (c + quiet) * cell,
          y: y + size - (r + quiet + 1) * cell,
          width: cell + 0.05,
          height: cell + 0.05,
          color: NAVY,
        });
}

const FOOTER_H = 66;

async function render(c: CompletionCertificate, totalCertPages: number) {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    sansBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    serif: await pdf.embedFont(StandardFonts.TimesRomanBold),
    serifReg: await pdf.embedFont(StandardFonts.TimesRoman),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  const { sans, sansBold, serif, serifReg, mono } = fonts;
  const logo = await pdf.embedPng(Buffer.from(REVERSED_LOGO_PNG_BASE64, 'base64'));
  const nib = await pdf.embedPng(Buffer.from(NIB_MARK_PNG_BASE64, 'base64'));
  const [W, H] = SIZES[c.pageSize];
  const M = 40;
  const CW = W - 2 * M;
  const bottom = M + FOOTER_H;
  const tz = c.timeZone;
  const t = (d: Date) => formatCertTime(d, tz);
  let page!: PDFPage;
  let y = 0;

  const text = (
    s: string,
    x: number,
    yy: number,
    f: PDFFont,
    size: number,
    color: RGB = NAVY,
    align: 'left' | 'right' | 'center' = 'left',
  ) => {
    const v = clean(f, s);
    const w = f.widthOfTextAtSize(v, size);
    page.drawText(v, {
      x: align === 'left' ? x : align === 'right' ? x - w : x - w / 2,
      y: yy,
      size,
      font: f,
      color,
    });
  };

  /** Page header: full band on the first page, a slim band with identifiers on later pages. */
  const newPage = (first: boolean) => {
    page = pdf.addPage([W, H]);
    if (first) {
      const bandH = 84;
      page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: NAVY });
      // Low gold wave along the bottom of the band.
      page.drawSvgPath(
        `M 0 6 C ${W * 0.25} 16, ${W * 0.55} -4, ${W} 4 L ${W} 0 C ${W * 0.55} -9, ${W * 0.25} 11, 0 1 Z`,
        { x: 0, y: H - bandH + 3, color: GOLD },
      );
      const lh = 56;
      page.drawImage(logo, {
        x: M - 4,
        y: H - bandH / 2 - lh / 2 + 3,
        width: (logo.width / logo.height) * lh,
        height: lh,
      });
      const right = W - M;
      text('Certificate of Completion', right, H - 42, serif, 22, WHITE, 'right');
      const sub = spaced('ELECTRONIC SIGNATURE RECORD');
      text(sub, right, H - 59, sans, 6.5, SOFT_GOLD, 'right');
      y = H - bandH - 20;
    } else {
      const bandH = 34;
      page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: NAVY });
      page.drawRectangle({ x: 0, y: H - bandH - 1.5, width: W, height: 1.5, color: GOLD });
      text('Certificate of Completion (continued)', M, H - 22, serif, 12, WHITE);
      text(
        `${c.certificateNumber}  •  ${c.verificationRef}`,
        W - M,
        H - 21,
        sans,
        8,
        SOFT_GOLD,
        'right',
      );
      y = H - bandH - 24;
    }
  };
  const ensure = (need: number, onBreak?: () => void) => {
    if (y - need < bottom) {
      newPage(false);
      onBreak?.();
    }
  };

  const sectionTitle = (label: string, ic: Parameters<typeof icon>[1]) => {
    icon(page, ic, M + 2, y + 13);
    text(label, M + 24, y, serif, 14);
    y -= 9;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
    y -= 12;
  };

  // ---------------------------------------------------------------------------------- page 1
  newPage(true);

  if (c.isTest) {
    panel(page, M, y + 12, CW, 22, { fill: RED_BG, r: 6 });
    text(
      'TEST REQUEST: created in a test environment. Not for real agreements.',
      W / 2,
      y - 3,
      sansBold,
      9,
      RED,
      'center',
    );
    y -= 30;
  }

  // Completion status.
  const pillW = 190;
  const pillX = W / 2 - pillW / 2;
  panel(page, pillX, y + 14, pillW, 30, { fill: GREEN_BG, r: 15 });
  page.drawCircle({ x: pillX + 17, y: y - 1, size: 10, color: GREEN });
  checkMark(page, pillX + 17, y - 1, 10);
  text('Signing Completed', pillX + 34, y - 7, serif, 16, NAVY);
  // Fine gold lines either side.
  page.drawLine({
    start: { x: M + 40, y: y - 1 },
    end: { x: pillX - 14, y: y - 1 },
    thickness: 0.6,
    color: GOLD,
  });
  page.drawLine({
    start: { x: pillX + pillW + 14, y: y - 1 },
    end: { x: W - M - 40, y: y - 1 },
    thickness: 0.6,
    color: GOLD,
  });
  y -= 28;
  for (const l of wrap(
    sans,
    'This certificate records the electronic signing activity associated with the agreement identified below.',
    9.5,
    CW - 20,
  )) {
    text(l, W / 2, y, sans, 9.5, SLATE, 'center');
    y -= 13;
  }
  if (c.reissue) {
    y -= 2;
    const r = c.reissue;
    for (const l of wrap(
      sans,
      `Reissued ${t(c.issuedAt).date} in the current certificate design. It replaces the certificate issued ${t(r.originalIssuedAt).both} (SHA-256 ${r.originalSha256.slice(0, 16)}…). The signed agreement and its evidence are unchanged.`,
      8,
      CW - 80,
    )) {
      text(l, W / 2, y, sans, 8, SLATE, 'center');
      y -= 11;
    }
  }
  y -= 10;

  // Agreement Information.
  {
    const colW = (CW - 40) / 2;
    const labelW = 86;
    const left: [string, string][] = [
      ['Document Title', c.title],
      ['Document ID', c.documentRef],
      ['Reference No.', c.verificationRef],
      ['Sender', c.senderName],
      ...(c.organization ? ([['Organization', c.organization]] as [string, string][]) : []),
    ];
    const pagesLine = `${c.agreementPages} Agreement ${c.agreementPages === 1 ? 'Page' : 'Pages'} + ${totalCertPages} Certificate ${totalCertPages === 1 ? 'Page' : 'Pages'}`;
    const right: [string, string][] = [
      ['Created', t(c.createdAt).both],
      ['Sent', c.sentAt ? t(c.sentAt).both : '—'],
      ['Completed', t(c.completedAt).both],
      ['Total Signers', String(c.signers.length)],
      ['Document Pages', pagesLine],
    ];
    const lay = (rows: [string, string][]) =>
      rows.map(([k, v]) => ({ k, lines: wrap(sans, v, 9, colW - labelW) }));
    const L = lay(left);
    const R = lay(right);
    const rowsH = (rows: { lines: string[] }[]) =>
      rows.reduce((a, r) => a + r.lines.length * 11 + 4, 0);
    const bodyH = Math.max(rowsH(L), rowsH(R));
    const h = 30 + bodyH + 10;
    ensure(h);
    panel(page, M, y + 6, CW, h, { fill: WHITE, border: LINE });
    page.drawSvgPath(`M 8 0 L ${CW - 8} 0 Q ${CW} 0 ${CW} 8 L ${CW} 28 L 0 28 L 0 8 Q 0 0 8 0 Z`, {
      x: M,
      y: y + 6,
      color: IVORY,
    });
    icon(page, 'doc', M + 14, y + 0);
    text('Agreement Information', M + 34, y - 13, serif, 13);
    let ly = y - 40;
    let ry = y - 40;
    for (const r of L) {
      text(r.k, M + 16, ly, sansBold, 8.5, NAVY);
      r.lines.forEach((l, i) => text(l, M + 16 + labelW, ly - i * 11.5, sans, 9, NAVY));
      ly -= r.lines.length * 11 + 4;
    }
    const rx = M + 16 + colW + 24;
    page.drawLine({
      start: { x: rx - 14, y: y - 34 },
      end: { x: rx - 14, y: y - 34 - bodyH + 6 },
      thickness: 0.6,
      color: LINE,
    });
    for (const r of R) {
      text(r.k, rx, ry, sansBold, 8.5, NAVY);
      r.lines.forEach((l, i) => text(l, rx + labelW, ry - i * 11.5, sans, 9, NAVY));
      ry -= r.lines.length * 11 + 4;
    }
    y -= h + 14;
  }

  // Signer Details.
  {
    const cols = [
      { k: '#', w: 18 },
      { k: 'Signer', w: 128 },
      { k: 'Role', w: 62 },
      { k: 'Authentication', w: 92 },
      { k: 'Signature Method', w: 76 },
      { k: 'Signed At', w: 88 },
      { k: 'Status', w: CW - 18 - 128 - 62 - 92 - 76 - 88 },
    ];
    const xs = cols.reduce<number[]>(
      (a, col, i) => [...a, i === 0 ? M : a[i - 1]! + cols[i - 1]!.w],
      [],
    );
    const head = () => {
      panel(page, M, y + 6, CW, 20, { fill: IVORY, r: 5 });
      cols.forEach((col, i) => text(col.k, xs[i]! + 6, y - 8, sansBold, 7.5, NAVY));
      y -= 24;
    };
    ensure(80);
    sectionTitle('Signer Details', 'people');
    head();
    c.signers.forEach((s, i) => {
      const nameL = wrap(sansBold, s.name, 8.5, cols[1]!.w - 10);
      const mailL = [
        ...wrap(sans, s.email, 7.5, cols[1]!.w - 10),
        ...(s.eventRef ? wrap(mono, s.eventRef, 6.5, cols[1]!.w - 10) : []),
      ];
      const roleL = wrap(sans, s.roleLabel, 8, cols[2]!.w - 10);
      const authL = wrap(sans, s.authLabel, 8, cols[3]!.w - 10);
      const methL = wrap(sans, s.methodLabel, 8, cols[4]!.w - 10);
      const when = formatCertTime(s.doneAt, s.timeZone || tz);
      const lines = Math.max(
        nameL.length + mailL.length,
        roleL.length,
        authL.length,
        methL.length,
        2,
      );
      const rowH = lines * 10.5 + 10;
      ensure(rowH + 4, head);
      const top = y;
      text(String(i + 1), xs[0]! + 6, top - 4, sans, 8.5, SLATE);
      nameL.forEach((l, j) => text(l, xs[1]! + 6, top - 4 - j * 10.5, sansBold, 8.5, NAVY));
      mailL.forEach((l, j) =>
        text(
          l,
          xs[1]! + 6,
          top - 4 - (nameL.length + j) * 10.5,
          s.eventRef && l.startsWith('EV-') ? mono : sans,
          s.eventRef && l.startsWith('EV-') ? 6.5 : 7.5,
          SLATE,
        ),
      );
      roleL.forEach((l, j) => text(l, xs[2]! + 6, top - 4 - j * 10.5, sans, 8, NAVY));
      authL.forEach((l, j) => text(l, xs[3]! + 6, top - 4 - j * 10.5, sans, 8, NAVY));
      methL.forEach((l, j) => text(l, xs[4]! + 6, top - 4 - j * 10.5, sans, 8, NAVY));
      text(when.date, xs[5]! + 6, top - 4, sans, 8, NAVY);
      text(when.time, xs[5]! + 6, top - 14.5, sans, 8, SLATE);
      const sx = xs[6]! + 6;
      const pw = sansBold.widthOfTextAtSize(s.statusLabel, 7.5) + 24;
      panel(page, sx, top + 6, pw, 15, { fill: GREEN_BG, r: 7.5 });
      page.drawCircle({ x: sx + 8, y: top - 1.5, size: 4.5, color: GREEN });
      checkMark(page, sx + 8, top - 1.5, 4.5);
      text(s.statusLabel, sx + 16, top - 4, sansBold, 7.5, GREEN);
      y -= rowH;
      page.drawLine({
        start: { x: M, y: y + 4 },
        end: { x: W - M, y: y + 4 },
        thickness: 0.4,
        color: LINE,
      });
    });
    y -= 4;
    const notes = [
      'Email-based methods show that the person controlled the email address; they do not independently establish identity.',
      ...(c.copyRecipients
        ? [
            `${c.copyRecipients} further ${c.copyRecipients === 1 ? 'recipient' : 'recipients'} received a copy and did not sign.`,
          ]
        : []),
      c.signingOrder
        ? 'Signing order: sequential, as set by the sender.'
        : 'Signing order: any order.',
    ];
    for (const n of notes)
      for (const l of wrap(sans, n, 7.5, CW)) {
        ensure(11);
        text(l, M, y, sans, 7.5, SLATE);
        y -= 10.5;
      }
    y -= 10;
  }

  // Signing Activity (Audit Trail) and Document Integrity & Verification.
  const tlNote = `Times in ${tz}. The full evidence log (${c.evidenceEventCount} events, with technical details such as IP addresses) stays with the sender's records.`;
  const pkiNote =
    'Check a copy by uploading it on the verification page (SHA-256 comparison). Documents are not sealed with a certificate-based (PKI) digital signature.';

  /** Timeline rows. Narrow layout puts the time under the text. Returns height used. */
  const timeline = (x: number, w: number, draw: boolean, narrow: boolean) => {
    const lineX = x + 9;
    const tsW = narrow ? 104 : 150;
    let h = 0;
    let prevDot: number | null = null;
    for (const e of c.events) {
      const f = e.final ? sansBold : sans;
      const lines = wrap(f, e.text, narrow ? 8.5 : 9, w - tsW - 30);
      const rowH = lines.length * 11 + (narrow ? 6 : 8);
      if (draw) {
        if (y - rowH < bottom) {
          newPage(false);
          prevDot = null;
        }
        const cy = y + 3;
        if (prevDot !== null)
          page.drawLine({
            start: { x: lineX, y: prevDot - 6 },
            end: { x: lineX, y: cy + 6 },
            thickness: 1,
            color: GOLD,
          });
        if (e.final) {
          page.drawCircle({ x: lineX, y: cy, size: 6.5, color: GREEN });
          checkMark(page, lineX, cy, 6.5);
        } else {
          page.drawCircle({
            x: lineX,
            y: cy,
            size: 5,
            color: WHITE,
            borderColor: GOLD,
            borderWidth: 1.2,
          });
          page.drawCircle({ x: lineX, y: cy, size: 1.8, color: GOLD });
        }
        lines.forEach((l, j) => text(l, x + 24, y - j * 11, f, narrow ? 8.5 : 9, NAVY));
        if (narrow)
          text(
            `${t(e.at).date} • ${t(e.at).time.replace(/\s\S+$/, '')}`,
            x + w,
            y,
            sans,
            7.5,
            SLATE,
            'right',
          );
        else text(t(e.at).both, x + w, y, sans, 8.5, SLATE, 'right');
        prevDot = cy;
        y -= rowH;
      }
      h += rowH;
    }
    return h;
  };

  /** Integrity panel. Compact layout for the right-hand column. Returns height used. */
  const integrity = (x: number, top: number, w: number, draw: boolean, compact: boolean) => {
    const qr = compact ? 66 : 96;
    const inner = compact ? w - 28 : w - qr - 76;
    const hs = compact ? 6.8 : 7.5;
    const hashRows: [string, string][] = [
      ['Signed agreement (SHA-256)', c.hashes.signed],
      ['Original upload (SHA-256)', c.hashes.original],
      // The chain head is in the evidence record; the wide layout prints it too.
      ...(compact ? [] : ([['Evidence chain head', c.hashes.chainHead]] as [string, string][])),
    ];
    const hashLines = hashRows.map(([k, v]) => ({ k, lines: wrap(mono, v, hs, inner) }));
    const hashesH = hashLines.reduce((a, hl) => a + 11 + hl.lines.length * (hs + 2) + 5, 0);
    const idsH = 2 * (compact ? 27 : 30);
    const qrBlock = compact ? qr + 14 : 0;
    const h = compact
      ? 34 + hashesH + idsH + qrBlock + 8
      : Math.max(34 + hashesH + idsH + 8, 34 + qr + 70);
    if (!draw) return h;
    panel(page, x, top + 6, w, h, { fill: WHITE, border: LINE });
    page.drawSvgPath(`M 8 0 L ${w - 8} 0 Q ${w} 0 ${w} 8 L ${w} 28 L 0 28 L 0 8 Q 0 0 8 0 Z`, {
      x,
      y: top + 6,
      color: IVORY,
    });
    icon(page, 'shield', x + 12, top + 1);
    text(
      compact ? 'Integrity & Verification' : 'Document Integrity & Verification',
      x + 32,
      top - 13,
      serif,
      compact ? 12 : 13,
    );
    let ly = top - 40;
    const lx = x + 14;
    for (const hl of hashLines) {
      text(hl.k, lx, ly, sansBold, 7.5, NAVY);
      ly -= 10.5;
      hl.lines.forEach((l) => {
        text(l, lx, ly, mono, hs, NAVY);
        ly -= hs + 2;
      });
      ly -= 5;
    }
    for (const [k, v] of [
      ['Certificate ID', c.certificateNumber],
      ['Verification Reference', c.verificationRef],
    ] as const) {
      text(k, lx, ly, sansBold, 7.5, NAVY);
      ly -= 6;
      const bw = Math.min(inner, mono.widthOfTextAtSize(v, 9.5) + 20);
      panel(page, lx, ly, bw, 17, { fill: IVORY, border: LINE, r: 4 });
      text(v, lx + 10, ly - 12, mono, 9.5, NAVY);
      ly -= compact ? 27 : 30;
    }
    const verifyText = (cx: number, vy: number, tw: number, align: 'left' | 'center') => {
      text('Verify this record', cx, vy, serif, 10.5, NAVY, align);
      vy -= 11;
      for (const l of wrap(sans, c.verifyUrl, 6.5, tw)) {
        text(l, cx, vy, sans, 6.5, ROYAL, align);
        vy -= 8.5;
      }
      text(`Reference ${c.verificationRef}`, cx, vy - 2, sansBold, 7, NAVY, align);
    };
    if (compact) {
      const qy = ly - qr + 6;
      drawQr(page, c.verifyUrl, lx, qy, qr);
      verifyText(lx + qr + 10, ly - 8, w - qr - 38, 'left');
    } else {
      const qx = x + w - 16 - qr;
      const qy = top - 34 - qr;
      page.drawLine({
        start: { x: qx - 18, y: top - 36 },
        end: { x: qx - 18, y: top - h + 22 },
        thickness: 0.8,
        color: GOLD,
      });
      drawQr(page, c.verifyUrl, qx, qy, qr);
      verifyText(qx + qr / 2, qy - 14, qr + 20, 'center');
    }
    return h;
  };

  const notes = (lines: string[], w: number) => {
    for (const n of lines)
      for (const l of wrap(sans, n, 7.5, w)) {
        ensure(11);
        text(l, M, y, sans, 7.5, SLATE);
        y -= 10.5;
      }
  };

  // Side by side, as in the approved design, when both fit on this page; stacked otherwise.
  const gap = 14;
  const leftW = Math.round(CW * 0.56);
  const rightW = CW - leftW - gap;
  const tlH = 24 + timeline(M, leftW, false, true);
  const inH = integrity(M + leftW + gap, y, rightW, false, true);
  const sideH = Math.max(tlH, inH) + 8;
  const noteH = (wrap(sans, tlNote, 7.5, CW).length + wrap(sans, pkiNote, 7.5, CW).length) * 10.5;
  if (y - sideH - noteH > bottom) {
    const top = y;
    icon(page, 'timeline', M + 2, y + 13);
    text('Signing Activity (Audit Trail)', M + 24, y, serif, 13);
    y -= 10;
    page.drawLine({ start: { x: M, y }, end: { x: M + leftW, y }, thickness: 0.6, color: LINE });
    y -= 14;
    timeline(M, leftW, true, true);
    integrity(M + leftW + gap, top + 6, rightW, true, true);
    y = top - sideH - 4;
    notes([tlNote, pkiNote], CW);
  } else {
    ensure(70);
    sectionTitle('Signing Activity (Audit Trail)', 'timeline');
    timeline(M, CW, true, false);
    y -= 2;
    notes([tlNote], CW);
    y -= 14;
    const h = integrity(M, y, CW, false, false);
    ensure(h + 4);
    integrity(M, y, CW, true, false);
    y -= h + 10;
    notes([pkiNote], CW);
  }

  // Footer on every page, drawn once the page count is known.
  const pages = pdf.getPages();
  const gen = t(c.issuedAt).both;
  pages.forEach((p, i) => {
    page = p;
    const fy = M + FOOTER_H - 4;
    p.drawLine({ start: { x: M, y: fy }, end: { x: W - M, y: fy }, thickness: 0.8, color: GOLD });
    // Seal: the gold nib inside a thin gold ring.
    const sx = M + 22;
    const sy = fy - 28;
    p.drawCircle({ x: sx, y: sy, size: 20, color: NAVY, borderColor: GOLD, borderWidth: 1.4 });
    p.drawCircle({ x: sx, y: sy, size: 16.5, borderColor: GOLD, borderWidth: 0.5 });
    const nh = 20;
    p.drawImage(nib, {
      x: sx - ((nib.width / nib.height) * nh) / 2,
      y: sy - nh / 2,
      width: (nib.width / nib.height) * nh,
      height: nh,
    });
    text('Electronic Signing Record', M + 52, fy - 20, serif, 11, NAVY);
    for (const [j, l] of wrap(
      sans,
      'This certificate documents electronic signing events recorded by Signature Tender for the associated agreement.',
      7,
      W - 2 * M - 52 - 150,
    ).entries())
      text(l, M + 52, fy - 31 - j * 9, sans, 7, SLATE);
    p.drawLine({
      start: { x: W - M - 138, y: fy - 10 },
      end: { x: W - M - 138, y: fy - 44 },
      thickness: 0.6,
      color: GOLD,
    });
    text('Signature Tender', W - M, fy - 24, serifReg, 13, NAVY, 'right');
    text(
      spaced('SECURE • SIMPLE • PROFESSIONAL').replace(/ {3}/g, '  '),
      W - M,
      fy - 36,
      sans,
      5.5,
      SLATE,
      'right',
    );
    text(
      `${c.certificateNumber}  •  Request ${c.requestId}  •  Generated ${gen}`,
      M,
      M - 2,
      sans,
      6.5,
      SLATE,
    );
    text(
      `Certificate Page ${i + 1} of ${pages.length}`,
      W - M,
      M - 2,
      sansBold,
      6.5,
      NAVY,
      'right',
    );
  });

  pdf.setTitle(`Certificate of Completion: ${clean(sans, c.title)}`);
  pdf.setSubject(`${c.certificateNumber} ${c.verificationRef}`);
  pdf.setProducer('Signature Tender');
  pdf.setCreator('Signature Tender');
  pdf.setCreationDate(c.issuedAt);
  pdf.setModificationDate(c.issuedAt);
  return pdf;
}

/** Builds the Certificate of Completion. Lays out twice so "N Certificate Pages" is exact. */
export async function buildCompletionCertificate(c: CompletionCertificate): Promise<Uint8Array> {
  const first = await render(c, 1);
  const n = first.getPageCount();
  const pdf = n === 1 ? first : await render(c, n);
  return pdf.save({ useObjectStreams: false });
}

/**
 * The complete package: signed agreement pages followed by the certificate. Deterministic for the
 * same inputs, so the hash recorded at completion matches every later download.
 */
export async function buildCompletionPackage(
  signed: Uint8Array,
  certificate: Uint8Array,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const a = await PDFDocument.load(signed, { updateMetadata: false });
  const b = await PDFDocument.load(certificate, { updateMetadata: false });
  for (const p of await out.copyPages(a, a.getPageIndices())) out.addPage(p);
  for (const p of await out.copyPages(b, b.getPageIndices())) out.addPage(p);
  // Metadata comes from the certificate itself, so every rebuild is byte-for-byte the same.
  const when = b.getCreationDate() ?? new Date(0);
  const title = (b.getTitle() ?? '').replace(/^Certificate of Completion: /, '') || 'Agreement';
  out.setTitle(`${title} (signed, with Certificate of Completion)`);
  out.setProducer('Signature Tender');
  out.setCreator('Signature Tender');
  out.setCreationDate(when);
  out.setModificationDate(when);
  return out.save({ useObjectStreams: false });
}
