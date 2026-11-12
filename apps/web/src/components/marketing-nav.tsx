'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type NavLink = { label: string; href: string; match?: string };
type NavGroup = { label: string; items: (NavLink & { description: string })[] };
type NavItem = NavLink | NavGroup;

/** Main navigation. Every link goes to a page or section that exists. */
export const NAV: NavItem[] = [
  { label: 'Product', href: '/product', match: '/product' },
  { label: 'How It Works', href: '/product#how-it-works' },
  { label: 'Pricing', href: '/pricing', match: '/pricing' },
  { label: 'Integrations', href: '/product#integrations' },
  { label: 'For Business', href: '/product#business' },
  {
    label: 'Resources',
    items: [
      {
        label: 'API documentation',
        href: '/developers',
        match: '/developers',
        description: 'Send for signature from your own software',
      },
      {
        label: 'FAQ',
        href: '/product#faq',
        description: 'Answers about signing, pricing and security',
      },
      {
        label: 'Get your documents',
        href: '/retrieve',
        description: 'Find a completed copy sent to your email',
      },
    ],
  },
];

const isGroup = (i: NavItem): i is NavGroup => 'items' in i;

function ResourcesMenu({ group, active }: { group: NavGroup; active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <li ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="nav-resources"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1 py-2 hover:text-rose-gold',
          active && 'text-rose-gold',
        )}
      >
        {group.label}{' '}
        <ChevronDown
          className={cn('size-4 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          id="nav-resources"
          className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-xl border border-border bg-white p-2 text-heading shadow-card"
        >
          {group.items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2 hover:bg-blush"
              >
                <span className="block text-sm font-semibold">{i.label}</span>
                <span className="block text-xs text-slate-text">{i.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Sticky public header: burgundy with a deeper, shadowed background once the page scrolls,
 * the current page marked (aria-current), and a full-screen menu on phones.
 */
export function MarketingNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    document.body.style.overflow = drawer ? 'hidden' : '';
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const activeLink = (l: NavLink) => Boolean(l.match && pathname === l.match);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 text-white transition-[background-color,box-shadow] duration-300',
        scrolled ? 'bg-primary-dark/95 shadow-lg backdrop-blur' : 'bg-primary',
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="Signature Tender home" className="shrink-0">
          <Image
            src="/brand/logo-reversed.png"
            alt="Signature Tender"
            width={327}
            height={168}
            className="h-auto w-32 rounded-lg sm:w-36"
            priority
          />
        </Link>
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-6 text-sm font-medium">
            {NAV.map((item) =>
              isGroup(item) ? (
                <ResourcesMenu
                  key={item.label}
                  group={item}
                  active={item.items.some((i) => activeLink(i))}
                />
              ) : (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    aria-current={activeLink(item) ? 'page' : undefined}
                    className={cn(
                      'relative py-2 hover:text-rose-gold',
                      activeLink(item) &&
                        'text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded after:bg-rose-gold',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden h-10 items-center rounded-lg border border-white/40 px-4 text-sm font-semibold hover:bg-white/10 sm:inline-flex"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center rounded-lg bg-rose-gold px-4 text-sm font-semibold text-primary-dark hover:bg-blush"
          >
            Get Started
          </Link>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10 lg:hidden"
            aria-label="Open menu"
            aria-expanded={drawer}
            aria-controls="mobile-menu"
            onClick={() => setDrawer(true)}
          >
            <Menu className="size-6" aria-hidden />
          </button>
        </div>
      </div>

      {drawer ? (
        <div
          id="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-50 flex flex-col bg-primary-dark text-white lg:hidden"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <Image
              src="/brand/logo-reversed.png"
              alt="Signature Tender"
              width={327}
              height={168}
              className="h-auto w-32 rounded-lg"
            />
            <button
              type="button"
              autoFocus
              className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10"
              aria-label="Close menu"
              onClick={() => setDrawer(false)}
            >
              <X className="size-6" aria-hidden />
            </button>
          </div>
          <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-4 pb-8">
            <ul className="flex flex-col divide-y divide-white/10 text-lg">
              {NAV.flatMap((item) => (isGroup(item) ? item.items : [item])).map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setDrawer(false)}
                    aria-current={activeLink(l) ? 'page' : undefined}
                    className={cn('block py-4', activeLink(l) && 'text-rose-gold')}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <Link
                href="/sign-in"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-white/40 font-semibold"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex h-12 items-center justify-center rounded-lg bg-rose-gold font-semibold text-primary-dark"
              >
                Get Started
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
