'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/workspaces', label: 'Workspaces' },
  { href: '/admin/operations', label: 'Operations' },
  { href: '/admin/signature-studio', label: 'Signature Studio' },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Staff">
      <ul className="flex gap-1">
        {ITEMS.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={path === i.href ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm ${path === i.href ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
