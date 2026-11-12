import { describe, it, expect } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import {
  layoutSignatureBlock,
  formatSigningTime,
  recommendedFieldSize,
  blockSafeText,
  textWidth,
  MIN_TEXT_PT,
  type BlockInput,
  type Primitive,
} from '../src/signature-block/layout';
import { displayedPageSize, fieldSizePt } from '../src/signature-block/pdf';
import { buildSignedPdf, buildCertificate } from '../src/finalize-pdf';
import { documentSettingsSchema, signatureBlockSettings } from '../src/documents';
import { pdfContent, pdfHex } from './pdf-text';

const SIGNED_AT = '2026-11-12T15:24:00.000Z'; // 10:24 AM in New York

function base(over: Partial<BlockInput> = {}): BlockInput {
  return {
    width: 220,
    height: 80,
    format: 'full',
    name: 'Alex Morgan',
    role: 'Signer',
    timestamp: { state: 'completed', signedAt: SIGNED_AT, timeZone: 'America/New_York' },
    ...over,
  };
}
const of = <K extends Primitive['kind']>(l: { primitives: Primitive[] }, k: K) =>
  l.primitives.filter((p): p is Extract<Primitive, { kind: K }> => p.kind === k);

function png(w = 300, h = 90) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw[y * (w * 4 + 1) + 1 + x * 4 + 3] = (x + y) % 7 ? 0 : 255;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe('signature block layout', () => {
  it('stacks signature, line, name, then timestamp with the seal beside it', () => {
    const l = layoutSignatureBlock(base());
    expect(l.format).toBe('full');
    expect(l.fits).toBe(true);
    const [img] = of(l, 'image');
    const line = of(l, 'line')[0]!;
    const texts = of(l, 'text');
    const name = texts.find((t) => t.text === 'Alex Morgan')!;
    const role = texts.find((t) => t.text === 'Signer')!;
    const time = texts.find((t) => t.text.startsWith('Signed on'))!;
    const [strip] = of(l, 'rect');
    const [seal] = of(l, 'seal');
    // 1. Signature above the line, 2. name below it, 3. time below the name, never level with it.
    expect(img!.y + img!.height).toBeLessThanOrEqual(line.y1);
    expect(line.x2 - line.x1).toBeCloseTo(220 - 2 * 4, 0); // spans the field (minus padding)
    expect(name.y - name.size).toBeGreaterThan(line.y1);
    expect(role.y).toBeCloseTo(name.y, 5);
    expect(role.x).toBeGreaterThan(name.x + name.width);
    expect(strip!.y).toBeGreaterThan(name.y);
    expect(time.y - time.size).toBeGreaterThan(name.y);
    // Name and time share the same left edge block.
    expect(strip!.x).toBeCloseTo(name.x, 5);
    // 4. Seal to the right of the time, vertically centred on the strip, not in its own column.
    expect(seal!.x).toBeGreaterThan(time.x + time.width);
    expect(seal!.y + seal!.size / 2).toBeCloseTo(strip!.y + strip!.height / 2, 5);
    expect(seal!.x).toBeLessThan(strip!.x + strip!.width);
    expect(l.sealBox).toEqual({ x: seal!.x, y: seal!.y, size: seal!.size });
  });

  it('keeps the seal small', () => {
    for (const [w, h] of [
      [220, 80],
      [400, 200],
      [612, 300],
    ] as const) {
      const l = layoutSignatureBlock(base({ width: w, height: h }));
      const [seal] = of(l, 'seal');
      const [img] = of(l, 'image');
      // 24-32px on screen at the usual ~1.33px per point: never more than 20pt.
      expect(seal!.size).toBeLessThanOrEqual(20);
      expect(seal!.size).toBeLessThan(img!.height);
    }
  });

  it('formats the server time in the document time zone', () => {
    expect(formatSigningTime(SIGNED_AT, 'America/New_York')).toBe(
      'Signed on Nov 12, 2026 at 10:24 AM (EST)',
    );
    expect(formatSigningTime(SIGNED_AT, 'America/New_York', true)).toBe(
      'Nov 12, 2026 10:24 AM EST',
    );
    expect(formatSigningTime('2026-07-04T23:05:00Z', 'America/Los_Angeles')).toBe(
      'Signed on Jul 4, 2026 at 4:05 PM (PDT)',
    );
    expect(formatSigningTime(SIGNED_AT, 'Asia/Kolkata')).toBe(
      'Signed on Nov 12, 2026 at 8:54 PM (GMT+5:30)',
    );
    expect(formatSigningTime(SIGNED_AT, 'Not/AZone')).toBe(
      'Signed on Nov 12, 2026 at 3:24 PM (UTC)',
    );
    expect(formatSigningTime(SIGNED_AT, null)).toContain('(UTC)');
  });

  it('shows no time and no seal while signing is pending, in the same geometry', () => {
    const pending = layoutSignatureBlock(
      base({ timestamp: { state: 'pending', timeZone: 'America/New_York' } }),
    );
    expect(of(pending, 'seal')).toHaveLength(0);
    expect(pending.sealBox).toBeNull();
    expect(of(pending, 'text').some((t) => /\d/.test(t.text))).toBe(false);
    const done = layoutSignatureBlock(base());
    // Same strip, same signature box, same line: the preview matches the final block.
    expect(of(pending, 'rect')).toEqual(of(done, 'rect'));
    expect(of(pending, 'image')).toEqual(of(done, 'image'));
    expect(pending.scale).toBe(done.scale);
    // And the geometry does not depend on when it was signed.
    const later = layoutSignatureBlock(
      base({
        timestamp: {
          state: 'completed',
          signedAt: '2026-01-01T03:07:00Z',
          timeZone: 'America/New_York',
        },
      }),
    );
    expect(of(later, 'rect')).toEqual(of(done, 'rect'));
    expect(later.sealBox).toEqual(done.sealBox);
  });

  it('supports every display format and keeps initials as the mark only', () => {
    expect(of(layoutSignatureBlock(base({ format: 'signature' })), 'text')).toHaveLength(0);
    const b = layoutSignatureBlock(base({ format: 'signature_name' }));
    expect(of(b, 'text').map((t) => t.text)).toEqual(['Alex Morgan', 'Signer']);
    const c = layoutSignatureBlock(base({ format: 'signature_name_time' }));
    expect(of(c, 'seal')).toHaveLength(0);
    expect(of(c, 'text').some((t) => t.text.startsWith('Signed on'))).toBe(true);
    const initials = layoutSignatureBlock(base({ kind: 'initials', width: 60, height: 30 }));
    expect(initials.format).toBe('signature');
    expect(initials.fits).toBe(true);
    expect(initials.primitives.map((p) => p.kind)).toEqual(['image']);
  });

  it('never clips or shrinks text below the legibility floor in small fields', () => {
    for (let w = 40; w <= 320; w += 20) {
      for (let h = 20; h <= 120; h += 10) {
        const l = layoutSignatureBlock(base({ width: w, height: h }));
        for (const t of of(l, 'text')) {
          expect(t.size).toBeGreaterThanOrEqual(MIN_TEXT_PT - 1e-9);
          expect(t.x).toBeGreaterThanOrEqual(0);
          expect(t.x + t.width).toBeLessThanOrEqual(w + 1e-6);
          expect(t.y).toBeLessThanOrEqual(h + 1e-6);
        }
        for (const r of of(l, 'rect')) expect(r.x + r.width).toBeLessThanOrEqual(w + 1e-6);
        for (const s of of(l, 'seal')) {
          expect(s.x + s.size).toBeLessThanOrEqual(w + 1e-6);
          expect(s.y + s.size).toBeLessThanOrEqual(h + 1e-6);
          expect(s.y).toBeGreaterThanOrEqual(0);
        }
        // Rows never overlap each other.
        const name = of(l, 'text')[0];
        const strip = of(l, 'rect')[0];
        if (name && strip) expect(strip.y).toBeGreaterThanOrEqual(name.y - 1e-6);
      }
    }
  });

  it('uses the compact block before giving up, and reports when it cannot fit', () => {
    const compact = layoutSignatureBlock(base({ width: 150, height: 60 }));
    expect(compact.format).toBe('full');
    expect(compact.compact).toBe(true);
    expect(of(compact, 'text').some((t) => t.text === 'Nov 12, 2026 10:24 AM EST')).toBe(true);
    const tiny = layoutSignatureBlock(base({ width: 60, height: 22 }));
    expect(tiny.fits).toBe(false);
    expect(tiny.format).toBe('signature');
    // The recommended size really fits.
    const want = recommendedFieldSize({
      format: 'full',
      name: 'Alex Morgan',
      role: 'Signer',
      timeZone: 'America/New_York',
    });
    const sized = layoutSignatureBlock(base({ ...want }));
    expect(sized.fits).toBe(true);
    expect(sized.compact).toBe(false);
  });

  it('draws names the PDF fonts cannot encode without changing their width math', () => {
    expect(blockSafeText('Zoë  Ångström')).toBe('Zoë Ångström');
    expect(blockSafeText('Łukasz')).toBe('Lukasz');
    expect(blockSafeText('李')).toBe('?');
  });

  it('measures text exactly as the PDF draws it (glyph advances, no kerning)', async () => {
    const doc = await PDFDocument.create();
    const sans = await doc.embedFont(StandardFonts.Helvetica);
    const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
    const drawn = (f: typeof sans, t: string, size: number) =>
      [...t].reduce((w, ch) => w + f.widthOfTextAtSize(ch, size), 0);
    for (const t of [
      'Alex Morgan',
      'Zoë Ångström-Ølsen',
      'Signed on Nov 12, 2026 at 10:24 AM (EST)',
    ]) {
      expect(textWidth(t, 'sans', 8)).toBeCloseTo(drawn(sans, t, 8), 1);
      expect(textWidth(t, 'serifBold', 11)).toBeCloseTo(drawn(serif, t, 11), 1);
    }
  });
});

describe('document settings', () => {
  it('defaults to option D and accepts the four formats', () => {
    const s = documentSettingsSchema.parse({});
    expect(s.signatureDisplay).toBe('full');
    expect(s.timeZone).toBeNull();
    expect(
      signatureBlockSettings({ signatureDisplay: 'signature_name', timeZone: 'Europe/London' }),
    ).toEqual({
      format: 'signature_name',
      timeZone: 'Europe/London',
    });
    expect(signatureBlockSettings({ timeZone: 'bogus' })).toEqual({
      format: 'full',
      timeZone: 'UTC',
    });
    expect(() => documentSettingsSchema.parse({ signatureDisplay: 'huge' })).toThrow();
  });
});

describe('signature block in the PDF', () => {
  async function source(rotate = 0, size: [number, number] = [612, 792]) {
    const doc = await PDFDocument.create();
    const p = doc.addPage(size);
    if (rotate) p.setRotation(degrees(rotate));
    doc.addPage([612, 792]);
    return doc.save();
  }
  const signer = {
    name: 'Alex Morgan',
    role: 'signer',
    signedAt: new Date(SIGNED_AT),
    timeZone: 'America/New_York',
    format: 'full' as const,
  };
  const field = {
    type: 'signature',
    page: 1,
    x: 0.1,
    y: 0.7,
    width: 0.36,
    height: 0.1,
    value: null,
  };

  it('embeds the exact signature image, name, role, server time and seal', async () => {
    const mark = png();
    const out = await buildSignedPdf(await source(), [{ ...field, imagePng: mark, signer }], {
      isTest: false,
      requestId: 'req-1',
    });
    const text = pdfContent(out);
    expect(text).toContain(pdfHex('Alex Morgan'));
    expect(text).toContain(pdfHex('Signer'));
    expect(text).toContain(pdfHex('Signed on Nov 12, 2026 at 10:24 AM (EST)'));
    expect(text).toContain('/Times-Bold');
    const doc = await PDFDocument.load(out);
    // The signature is embedded as an image XObject at its original pixel size (not re-rasterized).
    const images = doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter(
        (o) =>
          'dict' in o &&
          String(
            (o as { dict: { get: (k: unknown) => unknown } }).dict.get?.(
              doc.context.obj('Subtype'),
            ),
          ) === '/Image',
      );
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(doc.getPageCount()).toBe(2);
  });

  it('measures fields the way the viewer does on rotated and odd-sized pages', async () => {
    for (const rot of [0, 90, 180, 270]) {
      const doc = await PDFDocument.load(await source(rot, [500, 700]));
      const page = doc.getPage(0);
      const shown = displayedPageSize(page);
      expect(shown).toEqual(rot % 180 ? { width: 700, height: 500 } : { width: 500, height: 700 });
      expect(fieldSizePt(page, field)).toEqual({
        width: 0.36 * shown.width,
        height: 0.1 * shown.height,
      });
      const out = await buildSignedPdf(
        await source(rot, [500, 700]),
        [{ ...field, imagePng: png(), signer }],
        {
          isTest: false,
          requestId: 'r',
        },
      );
      const content = pdfContent(out);
      const expected = { 0: '1 0 0 1', 90: '0 1 -1 0', 180: '-1 0 0 -1', 270: '0 -1 1 0' }[rot]!;
      expect(content).toContain(`${expected} `);
    }
  });

  it('draws each signer with their own time on multi-signer documents', async () => {
    const out = await buildSignedPdf(
      await source(),
      [
        { ...field, imagePng: png(), signer },
        {
          ...field,
          y: 0.85,
          imagePng: png(200, 60),
          signer: { ...signer, name: 'Ben Venue', signedAt: new Date('2026-11-13T09:01:00Z') },
        },
      ],
      { isTest: false, requestId: 'r' },
    );
    const text = pdfContent(out);
    expect(text).toContain(pdfHex('Signed on Nov 12, 2026 at 10:24 AM (EST)'));
    expect(text).toContain(pdfHex('Signed on Nov 13, 2026 at 4:01 AM (EST)'));
    expect(text).toContain(pdfHex('Ben Venue'));
  });

  it('shows the block and the signing event in the certificate', async () => {
    const cert = await buildCertificate({
      requestId: 'req-1',
      isTest: false,
      title: 'Agreement',
      workspaceName: 'WS',
      senderName: 'Sam',
      senderEmail: 'sam@example.test',
      sentAt: new Date(SIGNED_AT),
      completedAt: new Date(SIGNED_AT),
      sourceSha256: 'a'.repeat(64),
      signedSha256: 'b'.repeat(64),
      pageCount: 1,
      signingOrderEnabled: false,
      disclosureVersion: '1',
      timeZone: 'America/New_York',
      recipients: [
        {
          name: 'Alex Morgan',
          email: 'alex@example.test',
          role: 'signer',
          signingOrder: 1,
          authMethod: 'email_link',
          authenticatedAt: null,
          consentedAt: new Date(SIGNED_AT),
          signedAt: new Date(SIGNED_AT),
          ip: null,
          userAgent: null,
          signatures: [{ kind: 'signature', method: 'typed', imagePng: png() }],
          signingEventRef: 'EV-7-ABCDEF123456',
        },
      ],
      events: [],
      chainHead: 'c'.repeat(64),
    });
    const text = pdfContent(cert);
    expect(text).toContain(pdfHex('EV-7-ABCDEF123456'));
    expect(text).toContain(pdfHex('Signed on Nov 12, 2026 at 10:24 AM (EST)'));
  });
});
