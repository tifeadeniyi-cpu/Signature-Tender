'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export function TemplateNav({ id, canUse }: { id: string; canUse: boolean }) {
  const path = usePathname();
  const tabs = [
    ['', 'Overview'],
    ['/roles', 'Roles'],
    ['/fields', 'Fields'],
    ['/settings', 'Settings'],
    ...(canUse ? [['/use', 'Use template']] : []),
  ];
  return (
    <nav aria-label="Template sections" className="mb-6">
      <ul className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map(([suffix, label]) => {
          const href = `/app/templates/${id}${suffix}`;
          const active = path === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px block border-b-2 px-3 py-2 text-sm',
                  active
                    ? 'border-primary font-semibold text-primary-dark'
                    : 'border-transparent text-heading hover:border-border',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
