import {
  LayoutDashboard,
  FileText,
  Layers,
  Contact,
  Users,
  CreditCard,
  Plug,
  Settings,
  Signature,
  PenLine,
  Receipt,
  ChartColumn,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@st/core';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only with at least one of these permissions. Pages enforce the same check server-side. */
  anyOf?: PermissionKey[];
  /** Shown only while Signature Studio is switched on. */
  studio?: boolean;
  /** Paths under `href` that belong to a different item, so both are not highlighted. */
  excludes?: string[];
  /** Highlight only when the address has this query parameter value. */
  query?: [string, string];
}

/** Primary navigation. Dashboard spec order, keeping Team, Billing and Integrations. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/app/documents',
    label: 'Documents',
    icon: FileText,
    anyOf: ['documents.view_own', 'documents.view_all'],
  },
  {
    href: '/app/signature-studio',
    label: 'Signature Studio',
    icon: Signature,
    studio: true,
    excludes: ['/app/signature-studio/library'],
  },
  { href: '/app/signature-studio/library', label: 'My Signatures', icon: PenLine, studio: true },
  { href: '/app/templates', label: 'Templates', icon: Layers, anyOf: ['templates.view'] },
  { href: '/app/contacts', label: 'Contacts', icon: Contact, anyOf: ['contacts.view'] },
  { href: '/app/team', label: 'Team', icon: Users, anyOf: ['team.view'] },
  {
    href: '/app/billing?tab=payments',
    label: 'Transactions',
    icon: Receipt,
    anyOf: ['billing.manage'],
    query: ['tab', 'payments'],
  },
  { href: '/app/billing', label: 'Billing & Credits', icon: CreditCard, anyOf: ['billing.manage'] },
  {
    href: '/app/reports',
    label: 'Reports',
    icon: ChartColumn,
    anyOf: ['documents.view_own', 'documents.view_all'],
  },
  { href: '/app/integrations', label: 'Integrations', icon: Plug },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

export function visibleNav(permissions: readonly string[], studioEnabled: boolean): NavItem[] {
  return NAV_ITEMS.filter(
    (n) =>
      (!n.studio || studioEnabled) && (!n.anyOf || n.anyOf.some((p) => permissions.includes(p))),
  );
}

export function isActive(
  pathname: string,
  href: string,
  item?: Pick<NavItem, 'excludes' | 'query'>,
  search?: URLSearchParams | null,
): boolean {
  const path = href.split('?')[0]!;
  if (path === '/app') return pathname === '/app';
  if (item?.excludes?.some((x) => pathname === x || pathname.startsWith(`${x}/`))) return false;
  const onPath = pathname === path || pathname.startsWith(`${path}/`);
  if (!onPath) return false;
  if (item?.query) return search?.get(item.query[0]) === item.query[1];
  // A plain item yields to a sibling that matches on query (Billing vs Transactions).
  if (search && path === '/app/billing') return search.get('tab') !== 'payments';
  return true;
}
