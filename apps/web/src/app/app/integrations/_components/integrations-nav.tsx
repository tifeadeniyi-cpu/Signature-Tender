'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Compass, Plug, Settings2, Workflow } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { href: '/app/integrations', label: 'Discover', icon: Compass },
  { href: '/app/integrations/connected', label: 'Connected Apps', icon: Plug },
  { href: '/app/integrations/automations', label: 'Automations', icon: Workflow },
  { href: '/app/integrations/activity', label: 'Activity & Sync Logs', icon: Activity },
  { href: '/app/integrations/settings', label: 'Settings', icon: Settings2 },
];

export function IntegrationsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Integrations" className="mb-6 border-b border-border">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm',
                  active
                    ? 'border-gold font-semibold text-heading'
                    : 'border-transparent text-slate-text hover:border-border hover:text-heading',
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
