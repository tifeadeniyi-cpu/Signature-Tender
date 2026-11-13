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
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Primary navigation, in the order given by spec Part 4.5. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/documents', label: 'Documents', icon: FileText },
  { href: '/app/templates', label: 'Templates', icon: Layers },
  { href: '/app/signature-studio', label: 'Signature Studio', icon: Signature },
  { href: '/app/contacts', label: 'Contacts', icon: Contact },
  { href: '/app/team', label: 'Team', icon: Users },
  { href: '/app/billing', label: 'Billing & Credits', icon: CreditCard },
  { href: '/app/integrations', label: 'Integrations', icon: Plug },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}
