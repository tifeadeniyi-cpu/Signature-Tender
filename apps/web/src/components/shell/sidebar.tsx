'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Menu, X, ChevronLeft, ChevronRight, Rocket, ArrowRight, Plus } from 'lucide-react';
import { NAV_ITEMS, isActive } from './nav';
import { cn } from '@/lib/cn';
import { BRAND_ASSETS } from '@/lib/brand-assets';

function NavList({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
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
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
              className={cn(
                'relative flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors',
                collapsed ? 'justify-center px-0' : 'px-3',
                active
                  ? 'bg-white/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-gold [&>svg]:text-gold'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {collapsed ? null : label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/app" className="block rounded-lg" aria-label="Signature Tender dashboard">
      {collapsed ? (
        <Image {...BRAND_ASSETS.nibMark} alt="" className="mx-auto h-auto w-9" priority />
      ) : (
        <Image {...BRAND_ASSETS.reversed} alt="Signature Tender" className="h-auto w-48" priority />
      )}
    </Link>
  );
}

/** Thin champagne-gold flourish used as a divider on the navy sidebar. */
function GoldWave({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 24" preserveAspectRatio="none" className={className} aria-hidden>
      <path
        d="M0 18 C 70 26, 150 2, 256 6"
        fill="none"
        stroke="url(#st-gold)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="st-gold" x1="0" x2="1">
          <stop offset="0" stopColor="#d8af68" stopOpacity="0.15" />
          <stop offset="0.6" stopColor="#f3deb4" />
          <stop offset="1" stopColor="#d8af68" stopOpacity="0.4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const STORAGE_KEY = 'st.sidebar.collapsed';
const EVENT = 'st:sidebar';

/** Remembers the collapsed sidebar per browser. Falls back to expanded if storage is unavailable. */
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

export function Sidebar() {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const toggle = () => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '0' : '1');
    } catch {
      /* ignore: storage unavailable */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col bg-gradient-to-b from-navy-royal via-primary to-primary-dark py-5 transition-[width] duration-200 lg:flex',
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
      <Brand collapsed={collapsed} />
      <GoldWave className="mt-3 h-5 w-full" />
      <nav aria-label="Primary" className="mt-4 flex-1 overflow-y-auto">
        <NavList collapsed={collapsed} />
      </nav>
      {collapsed ? (
        <Link
          href="/app/documents/new"
          title="Create document"
          aria-label="Create document"
          className="mx-auto flex size-11 items-center justify-center rounded-xl bg-gradient-to-b from-soft-gold to-gold text-primary hover:brightness-105"
        >
          <Plus className="size-5" aria-hidden />
        </Link>
      ) : (
        <div className="rounded-xl border border-white/15 bg-white/5 p-4">
          <div className="flex items-start gap-3">
            <Rocket className="mt-0.5 size-6 shrink-0 text-gold" aria-hidden />
            <div>
              <p className="font-semibold text-white">Get Started</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                Send your first document for signature in minutes.
              </p>
            </div>
          </div>
          <Link
            href="/app/documents/new"
            className="mt-4 flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-soft-gold to-gold text-sm font-semibold text-primary hover:brightness-105"
          >
            Create Document <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}
      <GoldWave className="mt-4 h-5 w-full opacity-70" />
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
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-gradient-to-b from-navy-royal via-primary to-primary-dark px-4 py-5"
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
