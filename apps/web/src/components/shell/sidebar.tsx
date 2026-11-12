'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NAV_ITEMS, isActive } from './nav';
import { cn } from '@/lib/cn';

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-navy-royal text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-gold [&>svg]:text-gold'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand() {
  return (
    <Link href="/app" className="block rounded-lg" aria-label="Signature Tender dashboard">
      <Image
        src="/brand/logo-reversed.png"
        alt="Signature Tender"
        width={327}
        height={168}
        className="h-auto w-40 rounded-lg"
        priority
      />
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-primary px-4 py-5 lg:flex">
      <Brand />
      <nav aria-label="Primary" className="mt-6 flex-1 overflow-y-auto">
        <NavList />
      </nav>
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-10 items-center justify-center rounded-lg text-primary hover:bg-primary-surface"
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-nav"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      {open ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-heading/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            id="mobile-nav"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-primary px-4 py-5"
          >
            <div className="flex items-start justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-white hover:bg-white/10"
                aria-label="Close navigation"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <nav aria-label="Primary" className="mt-6 overflow-y-auto">
              <NavList onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
