import { describe, it, expect } from 'vitest';
import type { CompletedPayload } from '@st/core';
import { renderDocumentCompleted, formatDateTime } from './document-completed';
import { esc, oneLine, safeEmail, safeUrl } from '../escape';
import { EMAIL_ASSETS } from '../assets.generated';

const payload: CompletedPayload = {
  requestId: '7b1f2c9e-4d1a-4a8e-9a51-2f6d8c3b5e10',
  documentId: 'a1b2c3d4-0000-4000-8000-000000000000',
  documentName: 'Fictional Venue Agreement',
  documentReference: '7b1f2c9e-4d1a-4a8e-9a51-2f6d8c3b5e10',
  documentPageCount: 8,
  completedAt: '2026-11-09T22:27:00.000Z',
  completedSignerCount: 2,
  requiredSignerCount: 2,
  senderName: 'Jordan Example',
  senderEmail: 'jordan@example.com',
  workspaceName: 'Example Studio',
  recipientName: 'Tope Sample',
  isTest: false,
  allowDownload: true,
  signedFileId: 's1',
  certificateFileId: 'c1',
};
const config = {
  companyName: 'Signature Tender',
  supportEmail: 'help@example.com',
  supportUrl: null,
  privacyUrl: 'https://app.example.com/legal/privacy',
  termsUrl: 'https://app.example.com/legal/terms',
  socials: [],
  timeZone: 'America/Chicago',
};
const links = {
  download: 'https://app.example.com/retrieve/link/TOKEN?to=download',
  view: 'https://app.example.com/retrieve/link/TOKEN?to=view',
  evidence: 'https://app.example.com/retrieve/link/TOKEN?to=evidence',
};
const render = (over: Partial<Parameters<typeof renderDocumentCompleted>[0]> = {}) =>
  renderDocumentCompleted({ payload, audience: 'recipient', links, config, ...over });

describe('Document Successfully Completed email', () => {
  it('has the approved subject, preview text, heading and calls to action', () => {
    const r = render();
    expect(r.subject).toBe(
      'Your Document Is Complete — Fictional Venue Agreement | Signature Tender',
    );
    expect(r.preheader).toBe(
      'All required signatures are complete. Your signed document is ready for secure download.',
    );
    expect(r.html).toContain('Your Document is Completed');
    expect(r.html).toContain('Document Successfully Completed');
    expect(r.html).toContain('All required signatures have been collected.');
    expect(r.html).toContain(`href="${esc(links.download)}"`);
    expect(r.html).toContain(`href="${esc(links.view)}"`);
    expect(r.html).toContain(`href="${esc(links.evidence)}"`);
    for (const label of ['Download Signed Document', 'View Document', 'View Evidence Certificate'])
      expect(r.html).toContain(label);
    expect(r.html).toContain('Send. Sign. Pay Once.');
  });

  it('shows real document details with the time zone, and the completion status', () => {
    const r = render();
    expect(r.text).toContain('Sender: Jordan Example (jordan@example.com)');
    expect(r.text).toContain('Completed: Nov 9, 2026, 4:27 PM CST');
    expect(r.text).toContain('Signers: 2 of 2 Completed');
    expect(r.text).toContain('Pages: 8');
    expect(r.text).toContain('Document ID: 7b1f2c9e-4d1a-4a8e-9a51-2f6d8c3b5e10');
    expect(r.html).toContain('Completed</span>');
    expect(formatDateTime('2026-07-01T15:00:00Z', 'America/New_York')).toBe(
      'Jul 1, 2026, 11:00 AM EDT',
    );
    expect(formatDateTime('2026-07-01T15:00:00Z', 'Not/AZone')).toBe('Jul 1, 2026, 3:00 PM UTC');
  });

  it('omits fields that are not available instead of inventing them', () => {
    const r = render({
      payload: {
        ...payload,
        documentPageCount: null,
        requiredSignerCount: 0,
        completedSignerCount: 0,
      },
    });
    expect(r.text).not.toContain('Pages:');
    expect(r.text).not.toContain('Signers:');
    expect(r.text).toContain('All required steps have been completed.');
  });

  it('uses only accurate assurance wording', () => {
    const r = render();
    for (const t of [
      'Your completed agreement is stored with document-integrity protections.',
      'A record of signing activity is available with your completed document.',
      'Retrieve your document securely through Signature Tender.',
      'Your agreement contains electronic signature records.',
    ])
      expect(r.html).toContain(t);
    expect(r.html).not.toMatch(/legally binding|certified|always accessible|ESIGN|UETA/i);
  });

  it('escapes every user-supplied value and drops unsafe links', () => {
    const r = render({
      payload: {
        ...payload,
        documentName: '<script>alert(1)</script>" onmouseover="x',
        senderName: '<img src=x onerror=alert(2)>',
        recipientName: 'Bob</td><a href="javascript:alert(3)">',
        senderEmail: 'evil"@x.com',
      },
      links: {
        download: 'javascript:alert(4)',
        view: 'http://evil.example.com/phish',
        evidence: 'https://user:pass@app.example.com/x',
      },
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toMatch(/<img src=x/);
    expect(r.html).not.toMatch(/href="javascript/i);
    // The injected markup survives only as visible, escaped text.
    expect(r.html).toContain('&lt;a href&#61;&quot;javascript:alert(3)&quot;&gt;');
    expect(r.html).not.toContain('evil.example.com');
    expect(r.html).not.toContain('user:pass');
    expect(r.html).not.toContain('onmouseover="');
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).not.toContain('mailto:evil');
    expect(r.html).not.toContain('Download Signed Document');
    // The subject is single-line text.
    expect(render({ payload: { ...payload, documentName: 'A\r\nBcc: x@y.z' } }).subject).toBe(
      'Your Document Is Complete — A Bcc: x@y.z | Signature Tender',
    );
  });

  it('respects downloads turned off by the sender, but senders can always open files', () => {
    const r = render({ payload: { ...payload, allowDownload: false } });
    expect(r.html).not.toContain('Download Signed Document');
    expect(r.html).not.toContain('View Evidence Certificate');
    expect(r.html).toContain('The sender has not turned on downloads for this document.');
    const s = render({ audience: 'sender', payload: { ...payload, allowDownload: false } });
    expect(s.html).toContain('Download Signed Document');
    expect(s.html).not.toContain('Questions about this document?');
  });

  it('never offers an evidence button without a certificate', () => {
    const r = render({ payload: { ...payload, certificateFileId: '' } });
    expect(r.html).not.toContain('View Evidence Certificate');
  });

  it('points recipients to the sender and to configured support only', () => {
    const r = render();
    expect(r.html).toContain('Questions about this document?');
    expect(r.html).toContain('mailto:jordan@example.com');
    expect(r.html).toContain('mailto:help@example.com');
    const none = render({
      config: { ...config, supportEmail: null, privacyUrl: null, termsUrl: null },
    });
    expect(none.html).not.toContain('Need help?');
    expect(none.html).not.toContain('Privacy Policy');
    expect(none.html).not.toContain('Terms of Service');
    const social = render({
      config: {
        ...config,
        socials: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/company/x' }],
      },
    });
    expect(social.html).toContain('https://www.linkedin.com/company/x');
    expect(r.html).not.toContain('linkedin');
  });

  it('marks test requests clearly', () => {
    const r = render({ payload: { ...payload, isTest: true } });
    expect(r.subject.startsWith('[TEST] ')).toBe(true);
    expect(r.html).toContain('<strong>TEST</strong> request');
  });

  it('is built for email clients: 640px, responsive, inline images with alt text', () => {
    const r = render();
    expect(r.html).toContain('max-width:640px');
    expect(r.html).toContain('@media only screen and (max-width:620px)');
    expect(r.html).toContain('<!--[if mso]>');
    expect(r.html).toContain('role="presentation"');
    const cids = [...r.html.matchAll(/src="cid:([a-z-]+)@signaturetender"/g)].map((m) => m[1]);
    expect(new Set(cids)).toEqual(new Set(r.attachments.map((a) => a.contentId.split('@')[0])));
    expect(cids).toContain('logo-reversed');
    for (const a of r.attachments) {
      expect(a.contentType).toBe('image/png');
      expect(a.content.subarray(1, 4).toString()).toBe('PNG');
    }
    expect(r.html).toMatch(/alt="Signature Tender"/);
    // Gmail clips messages over about 102 KB of HTML.
    expect(Buffer.byteLength(r.html)).toBeLessThan(90_000);
    expect(EMAIL_ASSETS['logo-reversed'].width).toBe(905);
  });
});

describe('output helpers', () => {
  it('escapes HTML and attribute characters', () => {
    expect(esc(`<a href="x" onclick='y'>&\`=`)).toBe(
      '&lt;a href&#61;&quot;x&quot; onclick&#61;&#39;y&#39;&gt;&amp;&#96;&#61;',
    );
  });
  it('validates links and addresses', () => {
    expect(safeUrl('https://a.example/x?y=1')).toBe('https://a.example/x?y=1');
    expect(safeUrl('http://localhost:3000/x')).toBeNull();
    expect(safeUrl('http://localhost:3000/x', { allowHttpLocal: true })).toBe(
      'http://localhost:3000/x',
    );
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('//evil.example')).toBeNull();
    expect(safeEmail('a.b+c@example.co')).toBe('a.b+c@example.co');
    expect(safeEmail('a@b')).toBeNull();
    expect(safeEmail('x"<y>@e.com')).toBeNull();
    expect(oneLine('a\n\tb c')).toBe('a b c');
  });
});
