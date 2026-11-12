import { describe, it, expect } from 'vitest';
import {
  renderCodeEmail,
  renderCompletedCopy,
  renderDeclinedNotice,
  renderPasswordReset,
  renderSigningRequest,
  renderTeamInvitation,
  renderVerifyEmail,
} from './transactional';
import { PREVIEW_KEYS, renderPreview } from '../previews';

const config = {
  companyName: 'Signature Tender',
  supportEmail: 'help@example.com',
  supportUrl: null,
  privacyUrl: 'https://app.example.com/legal/privacy',
  termsUrl: 'https://app.example.com/legal/terms',
  socials: [],
  timeZone: 'America/Chicago',
};
const now = new Date('2026-11-12T12:00:00Z');
const invite = (over: Partial<Parameters<typeof renderSigningRequest>[0]> = {}) =>
  renderSigningRequest({
    config,
    now,
    recipientName: 'Alex Morgan',
    recipientEmail: 'alex@example.com',
    senderName: 'Jordan Lee',
    workspaceName: 'Acme Corp',
    title: 'Service Agreement',
    message: null,
    url: 'https://app.example.com/sign/TOKEN',
    retrieveUrl: 'https://app.example.com/retrieve',
    isTest: false,
    ...over,
  });

describe('signing request', () => {
  it('has the subject, the button, the personal-link warning and the brand layout', () => {
    const r = invite();
    expect(r.subject).toBe('Please sign: Service Agreement');
    expect(r.html).toContain('Review &amp; Sign');
    expect(r.html).toContain('href="https://app.example.com/sign/TOKEN"');
    expect(r.html).toContain('Signature Request');
    expect(r.html).toContain('Awaiting your signature');
    expect(r.html).toContain('cid:hero-sign@signaturetender');
    expect(r.text.match(/https?:\/\/\S+/)![0]).toBe('https://app.example.com/sign/TOKEN');
    expect(r.text).toContain('personal to alex@example.com');
    expect(r.attachments.map((a) => a.contentId)).toContain('logo-reversed@signaturetender');
    expect(r.attachments.map((a) => a.contentId)).not.toContain('hero@signaturetender');
  });

  it('reminders read as reminders', () => {
    const r = invite({ reminder: true });
    expect(r.subject).toBe('Reminder: Please sign Service Agreement');
    expect(r.html).toContain('Friendly Reminder');
    expect(r.html).toContain('cid:hero-reminder@signaturetender');
  });

  it('escapes names, titles and the personal message, keeping line breaks', () => {
    const r = invite({
      title: '<img src=x onerror=alert(1)>',
      senderName: '"><script>x</script>',
      message: 'Line one\n<b>bold</b>',
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('Line one<br>&lt;b&gt;bold&lt;/b&gt;');
  });

  it('drops a button whose link is not https', () => {
    const r = invite({ url: 'javascript:alert(1)' });
    expect(r.html).not.toContain('javascript:');
    expect(r.html).not.toContain('Review &amp; Sign');
  });

  it('marks test requests', () => {
    const r = invite({ isTest: true });
    expect(r.subject.startsWith('[TEST] ')).toBe(true);
    expect(r.html).toContain('<strong>TEST</strong>');
  });
});

describe('other templates', () => {
  it('codes stay in the subject and are shown large', () => {
    const r = renderCodeEmail({
      config,
      purpose: 'signing',
      code: '482913',
      title: 'NDA',
      name: 'Alex',
    });
    expect(r.subject).toBe('Your signing code: 482913');
    expect(r.html).toContain('letter-spacing:10px');
    expect(r.html).toContain('482913');
    expect(r.text).toContain('Code: 482913');
    const a = renderCodeEmail({
      config,
      purpose: 'retrieval',
      code: '730415',
      returnUrl: 'https://app.example.com/retrieve',
    });
    expect(a.subject).toBe('Your document access code: 730415');
  });

  it('declined notice shows the reason and a red status', () => {
    const r = renderDeclinedNotice({
      config,
      title: 'NDA',
      recipientName: 'Taylor Smith',
      reason: 'Wrong dates',
      url: 'https://app.example.com/app/documents/1',
      isTest: false,
    });
    expect(r.subject).toBe('Declined: NDA');
    expect(r.html).toContain('Reason given');
    expect(r.html).toContain('Wrong dates');
    expect(r.html).toContain('#B42318');
  });

  it('account and team emails keep their subjects and links', () => {
    expect(renderVerifyEmail({ config, name: 'A', url: 'https://x.example.com/v' }).subject).toBe(
      'Verify your email for Signature Tender',
    );
    expect(renderPasswordReset({ config, url: 'https://x.example.com/r' }).text).toContain(
      'Choose a New Password: https://x.example.com/r',
    );
    const t = renderTeamInvitation({
      config,
      workspaceName: 'Acme',
      inviterName: 'Jordan',
      roleName: 'Member',
      expiresOn: 'Dec 9, 2026',
      url: 'https://x.example.com/invite/T',
    });
    expect(t.subject).toBe("You're invited to Acme");
    expect(t.html).toContain('Accept Invitation');
    const c = renderCompletedCopy({
      config,
      recipientName: 'A',
      recipientEmail: 'a@example.com',
      title: 'NDA',
      url: 'https://x.example.com/sign/T',
      retrieveUrl: 'https://x.example.com/retrieve',
      isTest: false,
    });
    expect(c.subject).toBe('Completed: NDA');
  });

  it('every preview renders with the shared header and footer', () => {
    for (const k of PREVIEW_KEYS) {
      const r = renderPreview(k, { ...config, appUrl: 'https://app.example.com' });
      expect(r.html).toContain('Send. Sign. Pay Once.');
      expect(r.html.length).toBeGreaterThan(5000);
      expect(r.text.length).toBeGreaterThan(50);
    }
  });
});
