'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import {
  LayoutDashboard,
  Building2,
  PenLine,
  Plug,
  ScrollText,
  Activity,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  type LucideIcon,
} from 'lucide-react';
import { BRAND_ASSETS } from '@/lib/brand-assets';
import { cn } from '@/lib/cn';

/** Each section names the permission it needs; the server passes the viewer's permissions. */
const SECTIONS: { href: string; label: string; icon: LucideIcon; permission: string }[] = [
  { href: '/admin', label: 'Command Center', icon: LayoutDashboard, permission: 'analytics.view' },
  {
    href: '/admin/workspaces',
    label: 'Organizations',
    icon: Building2,
    permission: 'analytics.view',
  },
  {
    href: '/admin/signature-studio',
    label: 'Signature Studio',
    icon: PenLine,
    permission: 'settings.manage',
  },
  { href: '/admin/audit', label: 'Audit Trail', icon: ScrollText, permission: 'audit.view' },
  { href: '/admin/operations', label: 'System Health', icon: Activity, permission: 'system.view' },
  { href: '/admin/integrations', label: 'Integrations', icon: Plug, permission: 'settings.manage' },
  { href: '/admin/access', label: 'Admin Access', icon: KeyRound, permission: 'access.view' },
];

const STORAGE_KEY = 'st.admin.sidebar.collapsed';
const EVENT = 'st:admin-sidebar';
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(EVENT, cb);
  };
}

function isActive(path: string, href: string) {
  return href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`);
}

function Links({ permissions, collapsed }: { permissions: string[]; collapsed?: boolean }) {
  const path = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {SECTIONS.filter((s) => permissions.includes(s.permission)).map(
        ({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  active
                    ? 'bg-gradient-to-r from-gold to-soft-gold font-semibold text-heading'
                    : 'text-slate-200 hover:bg-navy-royal hover:text-white',
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                {collapsed ? null : label}
              </Link>
            </li>
          );
        },
      )}
    </ul>
  );
}

/** Honest status: there is no independent uptime monitor yet, so none is claimed. */
function StatusCard({ collapsed }: { collapsed?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/15 text-xs text-slate-200',
        collapsed ? 'flex justify-center p-2' : 'flex items-start gap-2 p-3',
      )}
      title="Platform status: monitoring not configured"
    >
      <CircleDashed className="size-4 shrink-0 text-soft-gold" aria-hidden />
      {collapsed ? (
        <span className="sr-only">Platform status: monitoring not configured</span>
      ) : (
        <span>
          <span className="block font-semibold text-white">Platform status</span>
          Monitoring not configured. No independent uptime check is connected yet.
        </span>
      )}
    </div>
  );
}

export function AdminSidebar({ permissions, label }: { permissions: string[]; label: string }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const toggle = () => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '0' : '1');
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col bg-primary py-5 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-20 px-3' : 'w-64 px-4',
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        className="absolute -right-4 top-8 z-10 flex size-8 items-center justify-center rounded-full border-2 border-white bg-primary text-white shadow-card hover:bg-navy-royal"
      >
        {collapsed ? (
          <ChevronRight className="size-4" aria-hidden />
        ) : (
          <ChevronLeft className="size-4" aria-hidden />
        )}
      </button>
      <Link href="/admin" className="block rounded-lg" aria-label={`${label} home`}>
        {collapsed ? (
          <Image {...BRAND_ASSETS.nibMark} alt="" className="mx-auto h-auto w-9" priority />
        ) : (
          <Image
            {...BRAND_ASSETS.reversed}
            alt="Signature Tender"
            className="h-auto w-44"
            priority
          />
        )}
      </Link>
      {collapsed ? null : (
        <span className="mt-2 inline-block self-start rounded-md bg-gold px-2 py-0.5 text-xs font-semibold text-heading">
          {label}
        </span>
      )}
      <nav aria-label="Admin" className="mt-6 flex-1 overflow-y-auto">
        <Links permissions={permissions} collapsed={collapsed} />
      </nav>
      <StatusCard collapsed={collapsed} />
    </aside>
  );
}

/** Small screens: the same sections as a horizontally scrolling row. */
export function AdminMobileNav({ permissions }: { permissions: string[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="overflow-x-auto lg:hidden">
      <ul className="flex min-w-max gap-1 px-4 py-2">
        {SECTIONS.filter((s) => permissions.includes(s.permission)).map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              aria-current={isActive(path, s.href) ? 'page' : undefined}
              className={cn(
                'block rounded-lg px-3 py-1.5 text-sm',
                isActive(path, s.href)
                  ? 'bg-gold font-semibold text-heading'
                  : 'text-white hover:bg-white/10',
              )}
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
