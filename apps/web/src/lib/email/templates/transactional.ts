import type { EmailAssetName } from '../assets.generated';
import {
  EmailCanvas,
  brandFooter,
  brandHeader,
  codeBox,
  documentCard,
  emailDocument,
  finePrint,
  headline,
  heroIllustration,
  linkFallback,
  messageQuote,
  noticeBox,
  paragraph,
  primaryButton,
  spacer,
  strong,
  supportBlock,
  type CardRow,
  type EmailLinksConfig,
  type HeroName,
  type PillTone,
} from '../design';
import { esc, oneLine, safeEmail, safeUrl } from '../escape';
import type { RenderedEmail } from './document-completed';

/**
 * Every transactional email other than "Document Successfully Completed", on the same design
 * system: invitation to sign, reminder, completed copy, signing and access codes, declined notice,
 * team invitation, email verification and password reset.
 */

export type EmailConfigLike = EmailLinksConfig & { timeZone: string };

/** A paragraph: plain strings, plus { b } for a highlighted name or title. */
type Part = string | { b: string };
type Para = Part[];

const paraHtml = (p: Para) => p.map((x) => (typeof x === 'string' ? esc(x) : strong(x.b))).join('');
const paraText = (p: Para) => p.map((x) => (typeof x === 'string' ? x : `"${x.b}"`)).join('');

interface Spec {
  subject: string;
  preheader: string;
  headerTitle: string;
  hero: HeroName;
  heroAlt: string;
  headline: string;
  greeting?: string | null;
  intro: Para[];
  quote?: { label: string; text: string } | null;
  code?: { value: string; caption: string } | null;
  button?: { label: string; href: string | null; icon?: EmailAssetName } | null;
  card?: { title: string; rows: CardRow[]; status?: string; statusTone?: PillTone } | null;
  notice?: string | null;
  documentContact?: { name: string; email: string } | null;
  fine: string[];
  isTest?: boolean;
  config: EmailConfigLike;
  now?: Date;
  imageSrc?: (name: EmailAssetName) => string;
}

function render(s: Spec): RenderedEmail {
  const c = new EmailCanvas({ imageSrc: s.imageSrc });
  const cfg = s.config;
  const urlOpt = { allowHttpLocal: cfg.allowHttpLocal };
  const href = s.button ? safeUrl(s.button.href, urlOpt) : null;
  const subject = `${s.isTest ? '[TEST] ' : ''}${s.subject}`;
  const year = (s.now ?? new Date()).getUTCFullYear();
  const greeting = s.greeting ? oneLine(s.greeting, 120) : '';

  const html = emailDocument({
    title: subject,
    preheader: s.preheader,
    rows: [
      brandHeader(c, s.headerTitle),
      ...(s.isTest
        ? [noticeBox('<strong>TEST</strong> request from a non-production environment.')]
        : []),
      heroIllustration(c, s.heroAlt, s.hero),
      headline(s.headline),
      ...(greeting ? [paragraph(`Hello ${esc(greeting)},`, { size: 16, top: 10 })] : []),
      ...s.intro.map((p, i) => paragraph(paraHtml(p), { size: i === 0 ? 17 : 16, top: 6 })),
      ...(s.quote ? [messageQuote(s.quote.label, s.quote.text)] : []),
      ...(s.code ? [codeBox(s.code.value, s.code.caption)] : []),
      ...(href && s.button ? [primaryButton(c, s.button.label, href, s.button.icon)] : []),
      ...(href ? [linkFallback(href)] : []),
      ...(s.notice ? [noticeBox(esc(s.notice))] : []),
      ...(s.card
        ? [
            documentCard(c, {
              title: s.card.title,
              rows: s.card.rows,
              status: s.card.status,
              statusTone: s.card.statusTone,
              iconAlt: 'PDF document',
            }),
          ]
        : []),
      supportBlock(cfg, s.documentContact ?? null),
      finePrint(s.fine.map(esc).join('<br><br>')),
      spacer(4),
      brandFooter(c, cfg, year),
    ],
  });

  const support = safeUrl(cfg.supportUrl, urlOpt) ?? safeEmail(cfg.supportEmail);
  const contact = s.documentContact && safeEmail(s.documentContact.email);
  const text = [
    `${s.isTest ? '[TEST] ' : ''}${s.headline}`,
    '',
    ...(greeting ? [`Hello ${greeting},`, ''] : []),
    ...s.intro.map(paraText),
    ...(s.quote ? ['', `${s.quote.label}:`, s.quote.text] : []),
    ...(s.code ? ['', `Code: ${s.code.value}`, s.code.caption] : []),
    ...(href && s.button ? ['', `${s.button.label}: ${href}`] : []),
    ...(s.notice ? ['', s.notice] : []),
    ...(s.card
      ? [
          '',
          s.card.title,
          ...s.card.rows.map((r) => `${r.label}: ${r.value}${r.note ? ` ${r.note}` : ''}`),
          ...(s.card.status ? [`Status: ${s.card.status}`] : []),
        ]
      : []),
    ...(contact
      ? ['', `Questions about this document? Contact ${s.documentContact!.name} at ${contact}.`]
      : []),
    ...(support ? ['', `Need help? Contact ${cfg.companyName} Support: ${support}`] : []),
    '',
    ...s.fine,
    '',
    `${cfg.companyName} · Send. Sign. Pay Once.`,
    ...[
      ['Privacy Policy', safeUrl(cfg.privacyUrl, urlOpt)],
      ['Terms of Service', safeUrl(cfg.termsUrl, urlOpt)],
    ]
      .filter(([, u]) => u)
      .map(([l, u]) => `${l}: ${u}`),
  ].join('\n');

  return { subject, preheader: s.preheader, html, text, attachments: c.attachments() };
}

type Common = { config: EmailConfigLike; now?: Date; imageSrc?: (n: EmailAssetName) => string };

const fromLine = (sender: string, workspace: string) =>
  workspace && workspace !== sender ? `${sender} at ${workspace}` : sender;

// ---------------------------------------------------------------------------------------------

export function renderSigningRequest(
  i: Common & {
    recipientName: string;
    recipientEmail: string;
    senderName: string;
    workspaceName: string;
    title: string;
    message: string | null;
    url: string;
    retrieveUrl: string;
    isTest: boolean;
    reminder?: boolean;
  },
): RenderedEmail {
  const title = oneLine(i.title, 160) || 'Untitled document';
  const sender = oneLine(i.senderName, 120) || 'Someone';
  const workspace = oneLine(i.workspaceName, 120);
  const from = fromLine(sender, workspace);
  return render({
    ...i,
    subject: i.reminder ? `Reminder: Please sign ${title}` : `Please sign: ${title}`,
    preheader: i.reminder
      ? `${title} is still waiting for your signature.`
      : `${from} sent you ${title} to review and sign.`,
    headerTitle: i.reminder ? 'Friendly Reminder' : 'Signature Request',
    hero: i.reminder ? 'hero-reminder' : 'hero-sign',
    heroAlt: i.reminder ? 'Document waiting for a signature' : 'Document ready for your signature',
    headline: i.reminder ? 'A Document Is Waiting for You' : 'You’re Invited to Sign',
    greeting: i.recipientName,
    intro: i.reminder
      ? [
          [
            'This is a friendly reminder that ',
            { b: title },
            ` from ${from} is still waiting for your signature.`,
          ],
        ]
      : [
          [`${from} has sent you `, { b: title }, ' to review and sign.'],
          ['It only takes a few minutes, and you do not need an account.'],
        ],
    quote: i.message ? { label: `Message from ${sender}`, text: i.message.slice(0, 2000) } : null,
    button: { label: 'Review & Sign', href: i.url, icon: 'pen-white' },
    card: {
      title,
      rows: [
        { icon: 'user', label: 'From', value: from },
        { icon: 'mail', label: 'Sent to', value: oneLine(i.recipientEmail, 254) },
      ],
      status: 'Awaiting your signature',
      statusTone: 'amber',
    },
    fine: [
      `This link is personal to ${oneLine(i.recipientEmail, 254)}. Please do not forward it. Lost this email later? Get a copy or a new link at ${i.retrieveUrl}.`,
      `You are receiving this because ${from} asked you to sign a document with Signature Tender. This is a transactional message about it.`,
    ],
  });
}

export function renderCompletedCopy(
  i: Common & {
    recipientName: string;
    recipientEmail: string;
    title: string;
    url: string;
    retrieveUrl: string;
    isTest: boolean;
  },
): RenderedEmail {
  const title = oneLine(i.title, 160) || 'Untitled document';
  return render({
    ...i,
    subject: `Completed: ${title}`,
    preheader: 'Everyone has finished signing. Your personal link is inside.',
    headerTitle: 'Your Document is Completed',
    hero: 'hero',
    heroAlt: 'Signed document with a completed check mark',
    headline: 'Document Successfully Completed',
    greeting: i.recipientName,
    intro: [
      ['Everyone has finished signing ', { b: title }, '.'],
      [
        'Use your personal link to see the status and, if the sender allows it, download the signed copy.',
      ],
    ],
    button: { label: 'View Completed Document', href: i.url, icon: 'eye-white' },
    card: {
      title,
      rows: [{ icon: 'mail', label: 'Sent to', value: oneLine(i.recipientEmail, 254) }],
      status: 'Completed',
    },
    fine: [
      `This link is personal to ${oneLine(i.recipientEmail, 254)}. Please do not forward it. You can always get a new link at ${i.retrieveUrl}.`,
      'You are receiving this because you took part in signing this document. This is a transactional message about it.',
    ],
  });
}

export function renderCodeEmail(
  i: Common & {
    purpose: 'signing' | 'retrieval';
    code: string;
    name?: string | null;
    title?: string | null;
    returnUrl?: string | null;
    isTest?: boolean;
  },
): RenderedEmail {
  const title = i.title ? oneLine(i.title, 160) : null;
  const signing = i.purpose === 'signing';
  return render({
    ...i,
    subject: signing ? `Your signing code: ${i.code}` : `Your document access code: ${i.code}`,
    preheader: `Your one-time code is ${i.code}. It expires in 10 minutes.`,
    headerTitle: 'Verification Code',
    hero: 'hero-code',
    heroAlt: 'Document protected with a lock',
    headline: signing ? 'Your Signing Code' : 'Your Access Code',
    greeting: i.name ?? null,
    intro:
      signing && title
        ? [['Enter this code to open ', { b: title }, '.']]
        : [['Enter this code to see your documents on Signature Tender.']],
    code: { value: i.code, caption: 'Expires in 10 minutes · Works once' },
    button: i.returnUrl
      ? {
          label: signing ? 'Return to the Document' : 'Return to Signature Tender',
          href: i.returnUrl,
          icon: 'lock-white',
        }
      : null,
    notice: 'Never share this code. Signature Tender will never ask you for it by phone or email.',
    fine: [
      signing
        ? 'If you did not request this code, you can ignore this email.'
        : 'If you did not ask for this code, you can ignore this email. Nobody can see your documents without it.',
    ],
  });
}

export function renderDeclinedNotice(
  i: Common & {
    title: string;
    recipientName: string;
    reason: string | null;
    url: string;
    isTest: boolean;
  },
): RenderedEmail {
  const title = oneLine(i.title, 160) || 'Untitled document';
  const who = oneLine(i.recipientName, 120) || 'A recipient';
  return render({
    ...i,
    subject: `Declined: ${title}`,
    preheader: `${who} declined to sign ${title}.`,
    headerTitle: 'Signature Declined',
    hero: 'hero-declined',
    heroAlt: 'Document with a declined mark',
    headline: `${who} Declined to Sign`,
    intro: [
      [`${who} declined to sign `, { b: title }, '.'],
      [
        'The request has stopped and the other signing links no longer work. You can edit the document and send it again.',
      ],
    ],
    quote: i.reason ? { label: 'Reason given', text: i.reason.slice(0, 1000) } : null,
    button: { label: 'Open Document', href: i.url, icon: 'eye-white' },
    card: {
      title,
      rows: [{ icon: 'user', label: 'Declined by', value: who }],
      status: 'Declined',
      statusTone: 'red',
    },
    fine: [
      'This button opens the document in your Signature Tender workspace. You may be asked to sign in.',
      'You are receiving this because you sent this document for signature. This is a transactional message about it.',
    ],
  });
}

export function renderTeamInvitation(
  i: Common & {
    workspaceName: string;
    inviterName: string;
    roleName: string;
    expiresOn: string;
    url: string;
  },
): RenderedEmail {
  const ws = oneLine(i.workspaceName, 120) || 'a workspace';
  const inviter = oneLine(i.inviterName, 120) || 'A teammate';
  return render({
    ...i,
    subject: `You're invited to ${ws}`,
    preheader: `${inviter} invited you to join ${ws} on Signature Tender.`,
    headerTitle: 'Team Invitation',
    hero: 'hero-team',
    heroAlt: 'Document shared with a team',
    headline: `Join ${ws}`,
    intro: [
      [
        `${inviter} invited you to join `,
        { b: ws },
        ` on Signature Tender as ${oneLine(i.roleName, 60)}.`,
      ],
      ['Accept with the email address this message was sent to.'],
    ],
    button: { label: 'Accept Invitation', href: i.url, icon: 'users-white' },
    card: {
      title: ws,
      rows: [
        { icon: 'user', label: 'Invited by', value: inviter },
        { icon: 'shield', label: 'Role', value: oneLine(i.roleName, 60) },
        { icon: 'calendar', label: 'Expires', value: i.expiresOn },
      ],
      status: 'Invitation',
      statusTone: 'wine',
    },
    fine: ['If you were not expecting this, you can ignore it. Nothing happens unless you accept.'],
  });
}

export function renderVerifyEmail(i: Common & { name: string; url: string }): RenderedEmail {
  return render({
    ...i,
    subject: 'Verify your email for Signature Tender',
    preheader: 'Confirm your email address to finish creating your account.',
    headerTitle: 'Welcome',
    hero: 'hero-mail',
    heroAlt: 'Envelope with a check mark',
    headline: 'Confirm Your Email',
    greeting: i.name,
    intro: [
      ['Welcome to Signature Tender. Confirm this email address to finish creating your account.'],
    ],
    button: { label: 'Verify Email', href: i.url, icon: 'mail-white' },
    fine: [
      'The link expires in 24 hours.',
      'If you did not create a Signature Tender account, you can ignore this email.',
    ],
  });
}

export function renderPasswordReset(i: Common & { url: string }): RenderedEmail {
  return render({
    ...i,
    subject: 'Reset your Signature Tender password',
    preheader: 'Use this link within 1 hour to choose a new password.',
    headerTitle: 'Account Security',
    hero: 'hero-code',
    heroAlt: 'Document protected with a lock',
    headline: 'Reset Your Password',
    intro: [
      ['We received a request to reset your password. Choose a new one with the button below.'],
    ],
    button: { label: 'Choose a New Password', href: i.url, icon: 'lock-white' },
    notice: 'After you reset it, you will be signed out on your other devices.',
    fine: [
      'This link expires in 1 hour and works once.',
      'If you did not ask to reset your password, you can ignore this email. Your password stays the same.',
    ],
  });
}
