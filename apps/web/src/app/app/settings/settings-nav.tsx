'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, UserRound, ShieldCheck, Archive, Palette, Code2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/app/settings', label: 'Workspace Settings', icon: Building2 },
  { href: '/app/settings/profile', label: 'Profile & Account', icon: UserRound },
  { href: '/app/settings/security', label: 'Security', icon: ShieldCheck },
  { href: '/app/settings/branding', label: 'Branding', icon: Palette },
  { href: '/app/settings/retention', label: 'Retention', icon: Archive },
  { href: '/app/settings/developers', label: 'Developers', icon: Code2 },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings"
      className="rounded-2xl border border-border bg-white p-2 shadow-card lg:self-start"
    >
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
                  active
                    ? 'bg-rose-gold/60 font-semibold text-primary-dark'
                    : 'text-heading hover:bg-blush',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="hidden px-3 pb-2 pt-4 text-xs lg:block">
        Document defaults and notifications arrive in a later phase. Roles live on the Team page.
      </p>
    </nav>
  );
}
