/**
 * Privacy-first measurement helpers shared by the browser and the server. Everything is reduced
 * to a small fixed set of categories before it leaves the browser: raw referrer URLs, campaign
 * values, search terms and query strings are never sent or stored.
 */

export const TRAFFIC_SOURCES = [
  'direct',
  'search',
  'social',
  'ai_assistant',
  'email',
  'campaign',
  'referral',
] as const;
export type TrafficSource = (typeof TRAFFIC_SOURCES)[number];

export const SOURCE_LABEL: Record<string, string> = {
  direct: 'Direct or unknown',
  search: 'Search engines',
  social: 'Social media',
  ai_assistant: 'AI assistants',
  email: 'Email',
  campaign: 'Paid campaigns',
  referral: 'Other websites',
  other: 'Other (small groups)',
  not_recorded: 'Not recorded',
};

export const SITE_PAGES = [
  'home',
  'product',
  'pricing',
  'signature_studio',
  'verify',
  'legal',
  'sign_up',
  'sign_in',
] as const;

export const PAGE_LABEL: Record<string, string> = {
  home: 'Home',
  product: 'Product',
  pricing: 'Pricing',
  signature_studio: 'Signature Studio',
  verify: 'Verify a document',
  legal: 'Legal pages',
  sign_up: 'Create account',
  sign_in: 'Sign in',
  other: 'Other pages',
};

export function isTrafficSource(v: unknown): v is TrafficSource {
  return typeof v === 'string' && (TRAFFIC_SOURCES as readonly string[]).includes(v);
}

/** The page group for a public path. Specific paths (with ids or tokens) are never kept. */
export function pageGroup(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p === '/' || p === '') return 'home';
  if (p.startsWith('/product')) return 'product';
  if (p.startsWith('/pricing')) return 'pricing';
  if (p.startsWith('/signature-studio')) return 'signature_studio';
  if (p.startsWith('/verify')) return 'verify';
  if (p.startsWith('/legal')) return 'legal';
  if (p.startsWith('/sign-up')) return 'sign_up';
  if (p.startsWith('/sign-in')) return 'sign_in';
  return 'other';
}

const SEARCH = [
  /(^|\.)google\./,
  /(^|\.)bing\.com$/,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)search\.yahoo\.com$/,
  /(^|\.)yahoo\.com$/,
  /(^|\.)ecosia\.org$/,
  /(^|\.)baidu\.com$/,
  /(^|\.)yandex\./,
  /^search\.brave\.com$/,
  /(^|\.)startpage\.com$/,
  /(^|\.)qwant\.com$/,
];
const AI = [
  /(^|\.)chatgpt\.com$/,
  /^chat\.openai\.com$/,
  /(^|\.)perplexity\.ai$/,
  /^claude\.ai$/,
  /^gemini\.google\.com$/,
  /^copilot\.microsoft\.com$/,
  /(^|\.)you\.com$/,
];
const SOCIAL = [
  /(^|\.)facebook\.com$/,
  /(^|\.)fb\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)linkedin\.com$/,
  /^lnkd\.in$/,
  /^t\.co$/,
  /(^|\.)twitter\.com$/,
  /(^|\.)x\.com$/,
  /(^|\.)reddit\.com$/,
  /(^|\.)youtube\.com$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)pinterest\./,
  /(^|\.)threads\.net$/,
  /(^|\.)bsky\.app$/,
  /(^|\.)whatsapp\.com$/,
];
const MAIL = [
  /^mail\.google\.com$/,
  /(^|\.)outlook\.(live|office)\.com$/,
  /^mail\.yahoo\.com$/,
  /(^|\.)mail\.proton\.me$/,
];

/**
 * The coarse category for a visit, from the referrer and the landing URL's campaign tags. Only
 * the category is returned; the referrer and tag values themselves are discarded.
 */
export function classifySource(input: {
  referrer: string | null | undefined;
  url: string;
  ownHost: string;
}): TrafficSource {
  let params: URLSearchParams;
  try {
    params = new URL(input.url).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const medium = (params.get('utm_medium') ?? '').toLowerCase();
  const tagged = params.has('utm_source') || params.has('utm_medium') || params.has('utm_campaign');
  if (params.has('gclid') || params.has('msclkid') || /^(cpc|ppc|paid|display|cpm|ad)/.test(medium))
    return 'campaign';
  if (medium === 'email' || medium === 'newsletter') return 'email';
  if (medium === 'social' || medium === 'social-media') return 'social';

  let host = '';
  try {
    host = input.referrer ? new URL(input.referrer).hostname.toLowerCase() : '';
  } catch {
    host = '';
  }
  if (host && host !== input.ownHost.toLowerCase()) {
    if (AI.some((r) => r.test(host))) return 'ai_assistant';
    if (MAIL.some((r) => r.test(host))) return 'email';
    if (SEARCH.some((r) => r.test(host))) return 'search';
    if (SOCIAL.some((r) => r.test(host))) return 'social';
    return 'referral';
  }
  return tagged ? 'campaign' : 'direct';
}

export function isSitePage(v: unknown): v is string {
  return typeof v === 'string' && ((SITE_PAGES as readonly string[]).includes(v) || v === 'other');
}
