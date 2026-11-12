import {
  House,
  FileText,
  Layers,
  Contact,
  UsersRound,
  CreditCard,
  Puzzle,
  Settings,
  type LucideIcon,
} from 'lucide-react';

/** Sidebar preference lives in a cookie so the server renders the right width with no flash. */
export const SIDEBAR_COOKIE = 'st_sidebar';

export interface NavChild {
  label: string;
  /** Path, optionally with a `?tab=` filter that the page already understands. */
  href: string;
  /** Permission needed to see this link. Hiding is a convenience; pages still check. */
  permission?: string;
}

/** Icons are named, not passed as components, so the menu can be sent from server to browser. */
export const NAV_ICONS = {
  home: House,
  documents: FileText,
  templates: Layers,
  contacts: Contact,
  team: UsersRound,
  billing: CreditCard,
  integrations: Puzzle,
  settings: Settings,
} satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof NAV_ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  permission?: string;
  children?: NavChild[];
}

/**
 * Primary navigation, shared by the desktop sidebar and the phone drawer. Only routes that exist
 * are listed. Submenus reuse the pages' own tabs (`?tab=`) rather than separate pages.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/app', label: 'Dashboard', icon: 'home' },
  {
    href: '/app/documents',
    label: 'Documents',
    icon: 'documents',
    children: [
      { label: 'All Documents', href: '/app/documents' },
      { label: 'In Progress', href: '/app/documents?tab=in_progress' },
      { label: 'Completed', href: '/app/documents?tab=completed' },
      { label: 'Archived', href: '/app/documents?tab=archived' },
    ],
  },
  { href: '/app/templates', label: 'Templates', icon: 'templates', permission: 'templates.view' },
  { href: '/app/contacts', label: 'Contacts', icon: 'contacts', permission: 'contacts.view' },
  { href: '/app/team', label: 'Team', icon: 'team', permission: 'team.view' },
  {
    href: '/app/billing',
    label: 'Billing & Credits',
    icon: 'billing',
    children: [
      { label: 'Overview', href: '/app/billing' },
      { label: 'Buy Credits', href: '/app/billing?tab=credits' },
      { label: 'Plans & Pricing', href: '/app/billing?tab=plans' },
      { label: 'Invoices', href: '/app/billing?tab=invoices' },
      { label: 'Usage', href: '/app/billing?tab=usage' },
    ],
  },
  { href: '/app/integrations', label: 'Integrations', icon: 'integrations' },
  {
    href: '/app/settings',
    label: 'Settings',
    icon: 'settings',
    children: [
      { label: 'Workspace', href: '/app/settings' },
      { label: 'Profile', href: '/app/settings/profile' },
      { label: 'Branding', href: '/app/settings/branding' },
      { label: 'Security', href: '/app/settings/security' },
      { label: 'Data Retention', href: '/app/settings/retention' },
      { label: 'API Settings', href: '/app/settings/developers', permission: 'api.manage' },
    ],
  },
];

/** The menu this person may see. Never grants access: every page enforces its own checks. */
export function visibleNav(permissions: readonly string[], items = NAV_ITEMS): NavItem[] {
  const can = (p?: string) => !p || permissions.includes(p);
  return items
    .filter((i) => can(i.permission))
    .map((i) => (i.children ? { ...i, children: i.children.filter((c) => can(c.permission)) } : i));
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}

const DEFAULT_TAB: Record<string, string> = { '/app/documents': 'all', '/app/billing': 'overview' };

/**
 * Whether a submenu link is the current page. Tab links match on the `tab` query value; the
 * untabbed link of a tabbed page matches its default tab. Plain paths match exactly.
 */
export function isChildActive(pathname: string, tab: string | null, href: string): boolean {
  const [path, query] = href.split('?');
  const want = new URLSearchParams(query ?? '').get('tab');
  if (path! in DEFAULT_TAB) {
    if (pathname !== path) return false;
    const current = tab || DEFAULT_TAB[path!]!;
    return want ? current === want : current === DEFAULT_TAB[path!];
  }
  return pathname === path;
}
