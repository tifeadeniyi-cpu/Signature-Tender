import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  buildCompletionCertificate,
  buildCompletionPackage,
  formatCertTime,
  pageSizeFor,
  type CompletionCertificate,
} from '../src/certificate-pdf';
import {
  certificateEvents,
  certificateSigners,
  newVerificationRef,
  normalizeVerificationRef,
} from '../src/certificate';
import { pdfContent, pdfHex } from './pdf-text';

/** Hex of a phrase as drawn by pdf-lib, without the brackets, so it matches inside a longer line. */
const part = (s: string) => pdfHex(s).slice(1, -1);

const T = (iso: string) => new Date(iso);

const recipients = [
  {
    id: 'r1',
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    role: 'signer',
    authMethod: 'email_link',
    authenticatedAt: null,
    signedAt: T('2026-11-12T16:24:00Z'),
  },
  {
    id: 'r2',
    name: 'Alex Morgan',
    email: 'alex@example.com',
    role: 'signer',
    authMethod: 'email_code',
    authenticatedAt: T('2026-11-12T16:35:00Z'),
    signedAt: T('2026-11-12T16:41:00Z'),
  },
  {
    id: 'r3',
    name: 'Casey Brooks',
    email: 'casey@example.com',
    role: 'approver',
    authMethod: 'email_code',
    authenticatedAt: null,
    signedAt: T('2026-11-12T16:45:00Z'),
  },
  {
    id: 'r4',
    name: 'Morgan Reed',
    email: 'morgan@example.com',
    role: 'cc',
    authMethod: 'email_link',
    authenticatedAt: null,
    signedAt: null,
  },
];
const signatures = [
  { recipientId: 'r1', kind: 'signature', method: 'typed' },
  { recipientId: 'r1', kind: 'signature', method: 'typed' },
  { recipientId: 'r1', kind: 'initials', method: 'drawn' },
  { recipientId: 'r2', kind: 'signature', method: 'drawn' },
];
const ev = (seq: number, type: string, iso: string, recipientId: string | null = null) => ({
  seq,
  type,
  recipientId,
  createdAt: T(iso),
});

function sample(over: Partial<CompletionCertificate> = {}): CompletionCertificate {
  const completedAt = T('2026-11-12T16:45:10Z');
  return {
    pageSize: 'letter',
    isTest: false,
    title: 'Service Agreement',
    documentRef: 'ST-1A2B3C4D',
    requestId: '11111111-2222-3333-4444-555555555555',
    verificationRef: 'STV-7F3D-9AKQ',
    certificateNumber: 'CERT-2026-004318',
    senderName: 'Taylor Smith',
    organization: 'Acme Corp',
    createdAt: T('2026-11-10T20:15:00Z'),
    sentAt: T('2026-11-10T20:18:00Z'),
    completedAt,
    issuedAt: completedAt,
    reissue: null,
    agreementPages: 8,
    timeZone: 'America/New_York',
    signingOrder: true,
    signers: certificateSigners(recipients, signatures),
    copyRecipients: 1,
    events: certificateEvents({
      events: [
        ev(1, 'request.created', '2026-11-10T20:16:00Z'),
        ev(2, 'request.sent', '2026-11-10T20:18:00Z'),
        ev(3, 'recipient.notified', '2026-11-10T20:18:01Z', 'r1'),
        ev(4, 'recipient.viewed', '2026-11-12T16:20:00Z', 'r1'),
        ev(5, 'recipient.viewed', '2026-11-12T16:21:00Z', 'r1'),
        ev(6, 'recipient.session_started', '2026-11-12T16:20:00Z', 'r1'),
        ev(7, 'recipient.consented', '2026-11-12T16:22:00Z', 'r1'),
        ev(8, 'recipient.signed', '2026-11-12T16:24:00Z', 'r1'),
        ev(9, 'recipient.code_verified', '2026-11-12T16:35:00Z', 'r2'),
        ev(10, 'recipient.signed', '2026-11-12T16:41:00Z', 'r2'),
        ev(11, 'recipient.approved', '2026-11-12T16:45:00Z', 'r3'),
        ev(12, 'recipient.downloaded', '2026-11-13T09:00:00Z', 'r1'),
      ],
      recipients,
      senderName: 'Taylor Smith',
      uploadedAt: T('2026-11-10T20:15:00Z'),
      completedAt,
    }),
    evidenceEventCount: 11,
    hashes: { signed: 'a'.repeat(64), original: 'b'.repeat(64), chainHead: 'c'.repeat(64) },
    verifyUrl: 'https://app.example.com/verify?ref=STV-7F3D-9AKQ',
    ...over,
  };
}

describe('certificate evidence mapping', () => {
  it('lists each acting participant once with the action they actually took', () => {
    const s = certificateSigners(recipients, signatures);
    expect(s.map((x) => x.name)).toEqual(['Jordan Lee', 'Alex Morgan', 'Casey Brooks']);
    expect(s[0]).toMatchObject({
      methodLabel: 'Typed',
      statusLabel: 'Signed',
      authLabel: 'Email invitation link',
    });
    expect(s[1]).toMatchObject({ methodLabel: 'Drawn', authLabel: 'Email link + one-time code' });
    // A code that was required but never recorded as entered is not claimed.
    expect(s[2]).toMatchObject({
      statusLabel: 'Approved',
      methodLabel: '—',
      authLabel: 'Email invitation link',
    });
  });

  it('keeps time order, skips noise and post-completion events, and invents nothing', () => {
    const e = sample().events;
    const texts = e.map((x) => x.text);
    expect(texts[0]).toBe('Document uploaded');
    expect(texts).toContain('Signing request sent by Taylor Smith to 3 recipients');
    expect(texts.filter((x) => x === 'Jordan Lee opened the document')).toHaveLength(1);
    expect(texts.some((x) => /downloaded|session/i.test(x))).toBe(false);
    expect(texts.some((x) => x.startsWith('Alex Morgan opened'))).toBe(false); // never recorded
    expect(e.at(-1)!.final).toBe(true);
    for (let i = 1; i < e.length; i++) expect(e[i]!.at >= e[i - 1]!.at || i === 1).toBe(true);
  });

  it('verification references are public-format and normalised', () => {
    const r = newVerificationRef();
    expect(r).toMatch(/^STV-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeVerificationRef(` ${r.toLowerCase()} `)).toBe(r);
    expect(normalizeVerificationRef('stv-1234')).toBeNull();
  });

  it('formats times in the request time zone', () => {
    expect(formatCertTime(T('2026-11-12T16:24:00Z'), 'America/New_York').both).toBe(
      'Nov 12, 2026 • 11:24 AM EST',
    );
    expect(formatCertTime(T('2026-11-12T16:24:00Z'), 'Not/AZone').time).toContain('UTC');
  });
});

describe('certificate PDF', () => {
  it('prints the recorded facts on one Letter page for a single signer', async () => {
    const full = sample();
    const pdf = await buildCompletionCertificate({
      ...full,
      signers: full.signers.slice(0, 1),
      copyRecipients: 0,
      events: [...full.events.slice(0, 7), full.events.at(-1)!],
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const text = pdfContent(pdf);
    for (const s of [
      'Certificate of Completion',
      'Signing Completed',
      'Agreement Information',
      'Signer Details',
      'Signing Activity (Audit Trail)',
      'Integrity & Verification',
      'CERT-2026-004318',
      'STV-7F3D-9AKQ',
      '8 Agreement Pages + 1 Certificate',
      'Signed',
      'Certificate Page 1 of 1',
      'a'.repeat(32),
    ])
      expect(text, s).toContain(part(s));
  });

  it('shows approvals as approvals and continues onto a second page when needed', async () => {
    const pdf = await buildCompletionCertificate(sample());
    const text = pdfContent(pdf);
    expect(text).toContain(part('Approved'));
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    expect(text).toContain(part('Certificate Page 2 of 2'));
  });

  it('continues onto more pages instead of shrinking or dropping events, on A4 too', async () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 10, 12, 10, i)),
      text: `Event number ${i + 1}`,
    }));
    const pdf = await buildCompletionCertificate(sample({ pageSize: 'a4', events: many }));
    const doc = await PDFDocument.load(pdf);
    const n = doc.getPageCount();
    expect(n).toBeGreaterThan(1);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    const text = pdfContent(pdf);
    expect(text).toContain(part('Event number 1'));
    expect(text).toContain(part('Event number 70'));
    expect(text).toContain(part(`Certificate Page ${n} of ${n}`));
    expect(text).toContain(part(`8 Agreement Pages + ${n} Certificate`));
  });

  it('marks re-issued certificates and test requests', async () => {
    const text = pdfContent(
      await buildCompletionCertificate(
        sample({
          isTest: true,
          issuedAt: T('2026-11-13T02:00:00Z'),
          reissue: { originalIssuedAt: T('2026-11-12T16:45:10Z'), originalSha256: 'd'.repeat(64) },
        }),
      ),
    );
    expect(text).toContain(part('TEST REQUEST'));
    expect(text).toContain(part('Reissued'));
  });

  it('picks the page size from the agreement', () => {
    expect(pageSizeFor(612, 792)).toBe('letter');
    expect(pageSizeFor(595, 842)).toBe('a4');
    expect(pageSizeFor(842, 595)).toBe('a4');
  });

  it('the package is agreement then certificate, and identical every time it is built', async () => {
    const agreement = await PDFDocument.create();
    agreement.addPage([612, 792]);
    agreement.addPage([612, 792]);
    const signed = await agreement.save();
    const cert = await buildCompletionCertificate(sample({ agreementPages: 2 }));
    const a = await buildCompletionPackage(signed, cert);
    await new Promise((r) => setTimeout(r, 1100));
    const b = await buildCompletionPackage(signed, cert);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const doc = await PDFDocument.load(a);
    const certPages = (await PDFDocument.load(cert)).getPageCount();
    expect(doc.getPageCount()).toBe(2 + certPages);
  });
});
