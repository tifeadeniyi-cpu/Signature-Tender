import { EMAIL_ASSETS, type EmailAssetName } from './assets.generated';
import { esc, safeEmail, safeUrl } from './escape';

/**
 * Signature Tender email design system. Table-based, inline-styled components that render in
 * Gmail, Outlook (desktop and web), Apple Mail and mobile clients. Images are attached inline
 * (cid:) so they show without a public image host; every image has alt text and the layout still
 * reads correctly with images off.
 *
 * Shared by every transactional template (completed, invitation, reminder, declined, expired,
 * cancelled, account verification, password reset, payment receipt). Components return HTML strings;
 * dynamic values must already be plain text: components escape them.
 */

export const BRAND = {
  burgundy: '#5B0A1C',
  wine: '#7F1D3A',
  roseGold: '#E6B8A7',
  blush: '#F9E4E8',
  ivory: '#FFF9F7',
  slate: '#4B5563',
  ink: '#1F2937',
  white: '#FFFFFF',
  green: '#166534',
  greenBg: '#E3F5EA',
  footerDark: '#420714',
  serif: "'DM Serif Display', Georgia, 'Times New Roman', serif",
  sans: "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
} as const;

export interface EmailLinksConfig {
  companyName: string;
  supportEmail: string | null;
  supportUrl: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  socials: { label: string; url: string }[];
  allowHttpLocal?: boolean;
}

export interface InlineImage {
  filename: string;
  content: Buffer;
  contentType: string;
  contentId: string;
}

/** Collects the images a message uses, so only those are attached. */
export class EmailCanvas {
  private used = new Set<EmailAssetName>();
  constructor(private readonly opts: { imageSrc?: (name: EmailAssetName) => string } = {}) {}

  src(name: EmailAssetName): string {
    this.used.add(name);
    return this.opts.imageSrc ? this.opts.imageSrc(name) : `cid:${name}@signaturetender`;
  }

  img(name: EmailAssetName, width: number, height: number, alt: string, style = ''): string {
    return `<img src="${esc(this.src(name))}" width="${width}" height="${height}" alt="${esc(alt)}" style="display:block;border:0;outline:none;text-decoration:none;width:${width}px;height:${height}px;${style}">`;
  }

  attachments(): InlineImage[] {
    return [...this.used].map((name) => ({
      filename: `${name}.png`,
      content: Buffer.from(EMAIL_ASSETS[name].base64, 'base64'),
      contentType: 'image/png',
      contentId: `${name}@signaturetender`,
    }));
  }
}

/** Data-URI image sources, for the in-app preview (browsers do not resolve cid: links). */
export const previewImageSrc = (name: EmailAssetName) =>
  `data:image/png;base64,${EMAIL_ASSETS[name].base64}`;

// ---------------------------------------------------------------------------------------------
// Document shell

export function emailDocument(opts: { title: string; preheader: string; rows: string[] }): string {
  const css = `
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse}
    img{-ms-interpolation-mode:bicubic}
    a{color:${BRAND.wine}}
    a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
    u + #body a{color:inherit;text-decoration:none}
    @media only screen and (max-width:620px){
      .st-container{width:100%!important}
      .st-pad{padding-left:20px!important;padding-right:20px!important}
      .st-stack{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box}
      .st-btn-cell{padding:0 0 12px 0!important}
      .st-card-body{border-left:0!important;padding-left:0!important}
      .st-center{text-align:center!important}
      .st-hide{display:none!important}
      .st-hdr-title{border-left:0!important;padding:16px 0 0 0!important;text-align:left!important}
      .st-h1{font-size:26px!important;line-height:32px!important}
      .st-btn a{display:block!important}
      .st-card-icon{padding:0 0 12px 0!important}
    }`;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(opts.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;600;700&display=swap" rel="stylesheet"><!--<![endif]-->
<style>${css}</style>
</head>
<body id="body" style="margin:0;padding:0;width:100%;background-color:${BRAND.ivory};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(opts.preheader)}${'&#8204;&nbsp;'.repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.ivory}" style="background-color:${BRAND.ivory};">
<tr><td align="center" style="padding:24px 8px;">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="st-container" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background-color:${BRAND.white};border:1px solid #F1E2E2;border-radius:14px;overflow:hidden;border-collapse:separate;">
${opts.rows.join('\n')}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------
// Header and footer

export function brandHeader(c: EmailCanvas, title: string): string {
  return `<tr><td bgcolor="${BRAND.burgundy}" class="st-pad" style="background-color:${BRAND.burgundy};padding:28px 36px 8px 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="st-stack" valign="middle" width="190" style="width:190px;">${c.img('logo-reversed', 164, 84, 'Signature Tender', 'border-radius:10px;')}</td>
<td class="st-stack st-hdr-title" valign="middle" align="right" style="border-left:1px solid #9A4A5C;padding:4px 0 4px 24px;font-family:${BRAND.serif};font-size:26px;line-height:32px;color:${BRAND.white};text-align:right;">${esc(title)}<div style="height:3px;width:56px;margin:10px 0 0 auto;background-color:${BRAND.roseGold};font-size:0;line-height:0;">&nbsp;</div></td>
</tr></table>
</td></tr>
<tr><td style="padding:0;line-height:0;font-size:0;" bgcolor="${BRAND.white}">${c.img('wave-top', 640, 56, '', 'width:100%;max-width:640px;height:auto;')}</td></tr>`;
}

export function brandFooter(c: EmailCanvas, cfg: EmailLinksConfig, year: number): string {
  const opt = { allowHttpLocal: cfg.allowHttpLocal };
  const help =
    safeUrl(cfg.supportUrl, opt) ??
    (safeEmail(cfg.supportEmail) ? `mailto:${safeEmail(cfg.supportEmail)}` : null);
  const links = [
    ['Privacy Policy', safeUrl(cfg.privacyUrl, opt)],
    ['Terms of Service', safeUrl(cfg.termsUrl, opt)],
    ['Help &amp; Support', help],
  ]
    .filter(([, u]) => u)
    .map(
      ([label, u]) =>
        `<a href="${esc(u)}" style="color:${BRAND.white};text-decoration:underline;font-family:${BRAND.sans};font-size:13px;">${label}</a>`,
    )
    .join(`<span style="color:#B98C96;padding:0 10px;">|</span>`);
  const socials = cfg.socials
    .map((s) => ({ label: s.label, url: safeUrl(s.url, opt) }))
    .filter((s) => s.url)
    .map(
      (s) =>
        `<a href="${esc(s.url)}" style="color:${BRAND.roseGold};text-decoration:none;font-family:${BRAND.sans};font-size:13px;font-weight:600;padding-left:12px;">${esc(s.label)}</a>`,
    )
    .join('');
  return `<tr><td style="padding:0;line-height:0;font-size:0;" bgcolor="${BRAND.white}">${c.img('wave-bottom', 640, 56, '', 'width:100%;max-width:640px;height:auto;')}</td></tr>
<tr><td bgcolor="${BRAND.burgundy}" class="st-pad" style="background-color:${BRAND.burgundy};padding:8px 36px 22px 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="st-stack" valign="middle" width="140" style="width:140px;">${c.img('logo-reversed', 117, 60, 'Signature Tender', 'border-radius:8px;')}</td>
<td class="st-stack st-hdr-title" valign="middle" style="border-left:1px solid #9A4A5C;padding:0 0 0 22px;font-family:${BRAND.serif};font-style:italic;font-size:20px;line-height:26px;color:${BRAND.roseGold};">Send. Sign. Pay Once.</td>
${socials ? `<td class="st-stack st-center" valign="middle" align="right" style="padding-top:8px;">${socials}</td>` : ''}
</tr></table>
</td></tr>
<tr><td bgcolor="${BRAND.footerDark}" class="st-pad" align="center" style="background-color:${BRAND.footerDark};padding:20px 36px 24px 36px;font-family:${BRAND.sans};font-size:13px;line-height:20px;color:#F3DDE2;text-align:center;">
This message was sent by ${esc(cfg.companyName)}, a secure electronic signature platform.
${links ? `<div style="padding-top:10px;">${links}</div>` : ''}
<div style="padding-top:10px;color:#C9A3AC;font-size:12px;">&copy; ${year} ${esc(cfg.companyName)}. All rights reserved.</div>
</td></tr>`;
}

// ---------------------------------------------------------------------------------------------
// Body components

export function spacer(px: number): string {
  return `<tr><td style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</td></tr>`;
}

export function heroIllustration(c: EmailCanvas, alt: string): string {
  return `<tr><td align="center" style="padding:4px 36px 0 36px;">${c.img('hero', 140, 120, alt, 'margin:0 auto;')}</td></tr>`;
}

export function headline(text: string): string {
  return `<tr><td align="center" class="st-pad" style="padding:14px 36px 4px 36px;"><h1 class="st-h1" style="margin:0;font-family:${BRAND.serif};font-weight:400;font-size:32px;line-height:38px;color:${BRAND.burgundy};text-align:center;">${esc(text)}</h1></td></tr>`;
}

/** Paragraph. `html` must already be safe (built with esc/strong). */
export function paragraph(
  html: string,
  opts: { size?: number; color?: string; align?: 'center' | 'left'; top?: number } = {},
): string {
  const size = opts.size ?? 16;
  return `<tr><td align="${opts.align ?? 'center'}" class="st-pad" style="padding:${opts.top ?? 8}px 44px 0 44px;font-family:${BRAND.sans};font-size:${size}px;line-height:${Math.round(size * 1.55)}px;color:${opts.color ?? BRAND.ink};text-align:${opts.align ?? 'center'};">${html}</td></tr>`;
}

export const strong = (text: string) =>
  `<strong style="color:${BRAND.burgundy};font-weight:700;">${esc(text)}</strong>`;

export function primaryButton(
  c: EmailCanvas,
  label: string,
  href: string,
  icon?: EmailAssetName,
): string {
  const iconHtml = icon
    ? `<img src="${esc(c.src(icon))}" width="20" height="20" alt="" style="border:0;vertical-align:middle;width:20px;height:20px;margin-right:10px;">`
    : '';
  return `<tr><td align="center" class="st-pad" style="padding:26px 44px 0 44px;">
<table role="presentation" class="st-btn" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:separate;"><tr>
<td align="center" bgcolor="${BRAND.wine}" style="border-radius:10px;background-color:${BRAND.wine};background-image:linear-gradient(180deg,#A0234D 0%,${BRAND.burgundy} 100%);">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:${BRAND.serif};font-size:20px;line-height:24px;color:${BRAND.white};text-decoration:none;border-radius:10px;mso-padding-alt:0;">${iconHtml}<span style="vertical-align:middle;">${esc(label)}</span></a>
</td></tr></table>
</td></tr>`;
}

export function secondaryButtons(
  c: EmailCanvas,
  buttons: { label: string; href: string; icon?: EmailAssetName }[],
): string {
  if (!buttons.length) return '';
  const cells = buttons
    .map((b, i) => {
      const icon = b.icon
        ? `<img src="${esc(c.src(b.icon))}" width="18" height="18" alt="" style="border:0;vertical-align:middle;width:18px;height:18px;margin-right:8px;">`
        : '';
      return `<td class="st-stack st-btn-cell" width="${Math.floor(100 / buttons.length)}%" align="center" valign="top" style="padding:0 ${i < buttons.length - 1 ? '6' : '0'}px 0 ${i > 0 ? '6' : '0'}px;">
<table role="presentation" class="st-btn" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr>
<td align="center" bgcolor="${BRAND.white}" style="border:1.5px solid ${BRAND.wine};border-radius:10px;background-color:${BRAND.white};">
<a href="${esc(b.href)}" target="_blank" style="display:block;padding:12px 16px;font-family:${BRAND.sans};font-size:15px;line-height:20px;font-weight:600;color:${BRAND.wine};text-decoration:none;">${icon}<span style="vertical-align:middle;">${esc(b.label)}</span></a>
</td></tr></table></td>`;
    })
    .join('');
  return `<tr><td align="center" class="st-pad" style="padding:14px 64px 0 64px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>
</td></tr>`;
}

export function statusPill(c: EmailCanvas, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td bgcolor="${BRAND.greenBg}" style="background-color:${BRAND.greenBg};border-radius:999px;padding:6px 14px 6px 10px;font-family:${BRAND.sans};font-size:14px;line-height:18px;font-weight:700;color:${BRAND.green};white-space:nowrap;"><img src="${esc(c.src('check'))}" width="16" height="16" alt="" style="border:0;vertical-align:middle;width:16px;height:16px;margin-right:6px;"><span style="vertical-align:middle;">${esc(label)}</span></td></tr></table>`;
}

export interface CardRow {
  icon: EmailAssetName;
  label: string;
  /** Plain text value; escaped here. */
  value: string;
  /** Optional plain text shown after the value in a lighter color. */
  note?: string;
}

/** Rounded summary card: document icon, title, labelled rows and an optional status pill. */
export function documentCard(
  c: EmailCanvas,
  opts: { title: string; rows: CardRow[]; status?: string; iconAlt: string },
): string {
  const rows = opts.rows
    .map(
      (r) => `<tr>
<td valign="top" width="26" style="width:26px;padding:4px 10px 4px 0;">${c.img(r.icon, 18, 18, '')}</td>
<td valign="top" style="padding:3px 0;font-family:${BRAND.sans};font-size:15px;line-height:22px;color:${BRAND.ink};">${esc(r.label)}: <strong style="font-weight:600;color:${BRAND.ink};">${esc(r.value)}</strong>${r.note ? ` <span style="color:${BRAND.slate};">${esc(r.note)}</span>` : ''}</td>
</tr>`,
    )
    .join('');
  return `<tr><td class="st-pad" style="padding:28px 36px 0 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FCF2F3" style="background-color:#FCF2F3;border:1px solid #F3DCE0;border-radius:16px;border-collapse:separate;">
<tr><td style="padding:22px 22px 20px 22px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="st-stack st-card-icon" valign="top" width="84" style="width:84px;padding:4px 18px 0 0;">${c.img('pdf', 64, 64, opts.iconAlt)}</td>
<td class="st-stack st-card-body" valign="top" style="border-left:1px solid #EBC9D0;padding-left:20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="st-stack" valign="top" style="font-family:${BRAND.serif};font-size:22px;line-height:28px;color:${BRAND.burgundy};padding:0 12px 8px 0;word-break:break-word;">${esc(opts.title)}</td>
${opts.status ? `<td class="st-stack" valign="top" align="right" style="padding:0 0 8px 0;">${statusPill(c, opts.status)}</td>` : ''}
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
</td>
</tr></table>
</td></tr></table>
</td></tr>`;
}

/** Compact feature or assurance items, two per row (one per row on phones). */
export function infoGrid(
  c: EmailCanvas,
  items: { icon: EmailAssetName; title: string; text: string }[],
): string {
  const cell = (
    it: (typeof items)[number],
  ) => `<td class="st-stack" valign="top" width="50%" style="width:50%;padding:10px 10px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top" width="38" style="width:38px;padding:2px 10px 0 0;">${c.img(it.icon, 28, 28, '')}</td>
<td valign="top" style="font-family:${BRAND.sans};font-size:13px;line-height:19px;color:${BRAND.slate};"><div style="font-size:15px;line-height:21px;font-weight:700;color:${BRAND.burgundy};padding-bottom:2px;">${esc(it.title)}</div>${esc(it.text)}</td>
</tr></table></td>`;
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += 2)
    rows.push(
      `<tr>${cell(items[i]!)}${items[i + 1] ? cell(items[i + 1]!) : '<td class="st-hide" width="50%"></td>'}</tr>`,
    );
  return `<tr><td class="st-pad" style="padding:18px 36px 0 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FDF6F7" style="background-color:#FDF6F7;border-radius:14px;border-collapse:separate;">
<tr><td style="padding:8px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table></td></tr>
</table></td></tr>`;
}

/** Plain notice box (for example: downloads turned off by the sender). `html` must be safe. */
export function noticeBox(html: string): string {
  return `<tr><td class="st-pad" style="padding:22px 44px 0 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.blush}" style="background-color:${BRAND.blush};border-radius:12px;border-collapse:separate;">
<tr><td style="padding:14px 18px;font-family:${BRAND.sans};font-size:15px;line-height:22px;color:${BRAND.ink};text-align:center;">${html}</td></tr></table>
</td></tr>`;
}

/** Support and document-question block. Omits anything that is not configured. */
export function supportBlock(
  cfg: EmailLinksConfig,
  documentContact?: { name: string; email: string } | null,
): string {
  const opt = { allowHttpLocal: cfg.allowHttpLocal };
  const parts: string[] = [];
  const contact = documentContact && safeEmail(documentContact.email);
  if (documentContact && contact)
    parts.push(
      `<div style="font-weight:700;color:${BRAND.burgundy};">Questions about this document?</div>Contact ${esc(documentContact.name)} at <a href="mailto:${esc(contact)}" style="color:${BRAND.wine};text-decoration:underline;">${esc(contact)}</a>`,
    );
  const supportEmail = safeEmail(cfg.supportEmail);
  const supportUrl = safeUrl(cfg.supportUrl, opt);
  if (supportEmail || supportUrl) {
    const link = supportUrl
      ? `<a href="${esc(supportUrl)}" style="color:${BRAND.wine};text-decoration:underline;">${esc(cfg.companyName)} Support</a>`
      : `${esc(cfg.companyName)} Support at <a href="mailto:${esc(supportEmail!)}" style="color:${BRAND.wine};text-decoration:underline;">${esc(supportEmail!)}</a>`;
    parts.push(
      `<div style="font-weight:700;color:${BRAND.burgundy};${parts.length ? 'padding-top:12px;' : ''}">Need help?</div>Contact ${link}.`,
    );
  }
  if (!parts.length) return '';
  return `<tr><td class="st-pad" align="center" style="padding:26px 44px 0 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #EFDDE0;padding-top:20px;font-family:${BRAND.sans};font-size:15px;line-height:22px;color:${BRAND.ink};text-align:center;">${parts.join('')}</td></tr></table>
</td></tr>`;
}

/** Small print under the body (why you got this email, link safety). `html` must be safe. */
export function finePrint(html: string): string {
  return `<tr><td class="st-pad" align="center" style="padding:18px 44px 26px 44px;font-family:${BRAND.sans};font-size:12px;line-height:18px;color:${BRAND.slate};text-align:center;">${html}</td></tr>`;
}
