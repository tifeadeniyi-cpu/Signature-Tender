import type { CompletedPayload } from '@st/core';
import type { EmailAssetName } from '../assets.generated';
import {
  EmailCanvas,
  brandFooter,
  brandHeader,
  documentCard,
  emailDocument,
  finePrint,
  headline,
  heroIllustration,
  infoGrid,
  noticeBox,
  paragraph,
  primaryButton,
  secondaryButtons,
  spacer,
  strong,
  supportBlock,
  type CardRow,
  type EmailLinksConfig,
  type InlineImage,
} from '../design';
import { esc, oneLine, safeEmail, safeUrl } from '../escape';

export const TEMPLATE_VERSION = 'document_completed@1';

export interface CompletedEmailInput {
  payload: CompletedPayload;
  audience: 'sender' | 'recipient';
  /** Absolute URLs. Any link that is missing or not https is left out of the email. */
  links: { download: string | null; view: string | null; evidence: string | null };
  linkExpiresAt?: Date | null;
  config: EmailLinksConfig & { timeZone: string };
  /** Preview only: image sources other than cid: attachments. */
  imageSrc?: (name: EmailAssetName) => string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  attachments: InlineImage[];
}

/** "Nov 9, 2026, 4:27 PM CST" in the given IANA time zone (UTC if it is not valid). */
export function formatDateTime(iso: string | Date, timeZone: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d);
  }
}

function formatDate(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
  }
}

const ASSURANCES = [
  {
    icon: 'shield' as const,
    title: 'Secure & Verified',
    text: 'Your completed agreement is stored with document-integrity protections.',
  },
  {
    icon: 'layers' as const,
    title: 'Audit Trail Included',
    text: 'A record of signing activity is available with your completed document.',
  },
  {
    icon: 'lock' as const,
    title: 'Secure Access',
    text: 'Retrieve your document securely through Signature Tender.',
  },
  {
    icon: 'pen' as const,
    title: 'Electronic Signatures',
    text: 'Your agreement contains electronic signature records.',
  },
];

/** Renders the Document Successfully Completed email (HTML, plain text and inline images). */
export function renderDocumentCompleted(input: CompletedEmailInput): RenderedEmail {
  const { payload: p, audience, config: cfg } = input;
  const c = new EmailCanvas({ imageSrc: input.imageSrc });
  const urlOpt = { allowHttpLocal: cfg.allowHttpLocal };
  const name = oneLine(p.documentName, 160) || 'Untitled document';
  const recipientName = oneLine(p.recipientName, 120);
  const senderName = oneLine(p.senderName, 120);
  const senderEmail = safeEmail(p.senderEmail);
  const testPrefix = p.isTest ? '[TEST] ' : '';
  const subject = `${testPrefix}Your Document Is Complete — ${name} | Signature Tender`;
  const preheader =
    'All required signatures are complete. Your signed document is ready for secure download.';

  const canOpen = audience === 'sender' || p.allowDownload;
  const download = canOpen ? safeUrl(input.links.download, urlOpt) : null;
  const view = canOpen ? safeUrl(input.links.view, urlOpt) : null;
  const evidence = canOpen && p.certificateFileId ? safeUrl(input.links.evidence, urlOpt) : null;
  const completed = formatDateTime(p.completedAt, cfg.timeZone);
  const year = Number(
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' }).format(
      new Date(p.completedAt),
    ),
  );

  const rows: CardRow[] = [
    {
      icon: 'user',
      label: 'Sender',
      value: senderName,
      ...(senderEmail ? { note: `(${senderEmail})` } : {}),
    },
    { icon: 'calendar', label: 'Completed', value: completed },
  ];
  if (p.requiredSignerCount > 0)
    rows.push({
      icon: 'users',
      label: 'Signers',
      value: `${p.completedSignerCount} of ${p.requiredSignerCount} Completed`,
    });
  if (p.documentPageCount && p.documentPageCount > 0)
    rows.push({ icon: 'pages', label: 'Pages', value: String(p.documentPageCount) });
  rows.push({ icon: 'hash', label: 'Document ID', value: p.documentReference });

  const lead =
    p.requiredSignerCount > 0
      ? 'All required signatures have been collected.'
      : 'All required steps have been completed.';
  const body = canOpen
    ? `Your document, ${strong(name)}, is now completed and ready for download.`
    : `Your document, ${strong(name)}, is now completed.`;

  const secondary = [
    ...(view ? [{ label: 'View Document', href: view, icon: 'eye' as const }] : []),
    ...(evidence
      ? [{ label: 'View Evidence Certificate', href: evidence, icon: 'shield' as const }]
      : []),
  ];

  const expiryNote =
    audience === 'recipient' && input.linkExpiresAt
      ? ` The buttons work until ${esc(formatDate(input.linkExpiresAt, cfg.timeZone))}; after that you can request a new secure link.`
      : '';
  const fine =
    audience === 'recipient'
      ? `For your security, these buttons ask you to confirm this email address with a one-time code before the document opens, so forwarding this email does not give anyone else access.${expiryNote}`
      : 'These buttons open the document in your Signature Tender workspace. You may be asked to sign in.';
  const why =
    audience === 'recipient'
      ? `You are receiving this because you took part in signing this document. This is a transactional message about it.`
      : `You are receiving this because you sent this document for signature. This is a transactional message about it.`;

  const html = emailDocument({
    title: subject,
    preheader,
    rows: [
      brandHeader(c, 'Your Document is Completed'),
      ...(p.isTest
        ? [noticeBox('<strong>TEST</strong> request from a non-production environment.')]
        : []),
      heroIllustration(c, 'Signed document with a completed check mark'),
      headline('Document Successfully Completed'),
      ...(recipientName ? [paragraph(`Hello ${esc(recipientName)},`, { size: 16, top: 10 })] : []),
      paragraph(esc(lead), { size: 18, top: 6 }),
      paragraph(body, { size: 16, top: 6 }),
      ...(download ? [primaryButton(c, 'Download Signed Document', download, 'download')] : []),
      ...(!canOpen
        ? [
            noticeBox(
              `The sender has not turned on downloads for this document.${senderEmail ? ` For a copy, contact ${esc(senderName)} at <a href="mailto:${esc(senderEmail)}" style="color:#7F1D3A;">${esc(senderEmail)}</a>.` : ' Contact the sender for a copy.'}`,
            ),
          ]
        : []),
      secondaryButtons(c, secondary),
      documentCard(c, { title: name, rows, status: 'Completed', iconAlt: 'PDF document' }),
      infoGrid(c, ASSURANCES),
      supportBlock(
        cfg,
        audience === 'recipient' && senderEmail ? { name: senderName, email: senderEmail } : null,
      ),
      finePrint(`${fine}<br><br>${why}`),
      spacer(4),
      brandFooter(c, cfg, year),
    ],
  });

  const lines = [
    `${testPrefix}Document Successfully Completed`,
    '',
    ...(recipientName ? [`Hello ${recipientName},`, ''] : []),
    lead,
    canOpen
      ? `Your document, "${name}", is now completed and ready for download.`
      : `Your document, "${name}", is now completed. The sender has not turned on downloads for it${senderEmail ? `; for a copy, contact ${senderName} at ${senderEmail}` : ''}.`,
    '',
    ...(download ? [`Download Signed Document: ${download}`] : []),
    ...(view ? [`View Document: ${view}`] : []),
    ...(evidence ? [`View Evidence Certificate: ${evidence}`] : []),
    ...(download || view || evidence ? [''] : []),
    name,
    ...rows.map((r) => `${r.label}: ${r.value}${r.note ? ` ${r.note}` : ''}`),
    'Status: Completed',
    '',
    ...ASSURANCES.map((a) => `${a.title}: ${a.text}`),
    '',
    ...(audience === 'recipient' && senderEmail
      ? [`Questions about this document? Contact ${senderName} at ${senderEmail}.`]
      : []),
    ...(safeUrl(cfg.supportUrl, urlOpt) || safeEmail(cfg.supportEmail)
      ? [
          `Need help? Contact ${cfg.companyName} Support: ${safeUrl(cfg.supportUrl, urlOpt) ?? safeEmail(cfg.supportEmail)}`,
        ]
      : []),
    '',
    fine.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, (m) => (m === '&amp;' ? '&' : m)),
    why,
    '',
    `${cfg.companyName} · Send. Sign. Pay Once.`,
    ...[
      ['Privacy Policy', safeUrl(cfg.privacyUrl, urlOpt)],
      ['Terms of Service', safeUrl(cfg.termsUrl, urlOpt)],
    ]
      .filter(([, u]) => u)
      .map(([l, u]) => `${l}: ${u}`),
  ];

  return { subject, preheader, html, text: lines.join('\n'), attachments: c.attachments() };
}
