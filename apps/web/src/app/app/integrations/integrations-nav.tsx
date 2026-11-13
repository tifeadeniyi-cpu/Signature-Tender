'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, Plug, Workflow, ScrollText } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/app/integrations', label: 'Discover', icon: Compass },
  { href: '/app/integrations/connected', label: 'Connected Apps', icon: Plug },
  { href: '/app/integrations/automations', label: 'Automations', icon: Workflow },
  { href: '/app/integrations/activity', label: 'Activity & Sync Logs', icon: ScrollText },
];

export function IntegrationsNav() {
  const pathname = usePathname();
  const known = ITEMS.some((i) => i.href === pathname);
  return (
    <nav aria-label="Integrations" className="mb-6 overflow-x-auto border-b border-border">
      <ul className="flex min-w-max gap-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          // App detail pages belong to Discover.
          const active = pathname === href || (!known && href === '/app/integrations');
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm',
                  active
                    ? 'border-gold font-semibold text-heading'
                    : 'border-transparent text-slate-text hover:text-heading',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
