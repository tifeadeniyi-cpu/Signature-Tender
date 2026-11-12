'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
  Plus,
  Rocket,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { BRAND_ASSETS } from '@/lib/brand-assets';
import { NAV_ICONS, SIDEBAR_COOKIE, isActive, isChildActive, type NavItem } from './nav';

export interface SidebarProps {
  items: NavItem[];
  initialCollapsed: boolean;
  /** Null when this person cannot create documents. */
  cta: { returning: boolean } | null;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

// ---------------------------------------------------------------------------------------------
// Decoration

function GoldStroke({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 280 28"
      preserveAspectRatio="none"
      className={cn('pointer-events-none block h-5 w-full', className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="st-gold-a" x1="0" x2="1">
          <stop offset="0" stopColor="#D8AF68" stopOpacity="0" />
          <stop offset="0.45" stopColor="#F3DEB4" stopOpacity="0.9" />
          <stop offset="1" stopColor="#D8AF68" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path
        d="M0 22 C 70 26, 150 2, 280 6"
        fill="none"
        stroke="url(#st-gold-a)"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/** Two thin gold strokes in their own strip at the bottom, so they never sit over a control. */
export function SidebarGoldWave() {
  return (
    <svg
      viewBox="0 0 280 70"
      preserveAspectRatio="none"
      className="pointer-events-none block h-14 w-full shrink-0"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id="st-gold-b" x1="0" x2="1">
          <stop offset="0" stopColor="#D8AF68" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="#F3DEB4" stopOpacity="0.75" />
          <stop offset="1" stopColor="#D8AF68" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <path
        d="M0 30 C 60 12, 120 58, 190 44 S 260 20, 280 26"
        fill="none"
        stroke="url(#st-gold-b)"
        strokeWidth="1.6"
      />
      <path
        d="M0 46 C 70 30, 130 70, 200 58 S 262 36, 280 40"
        fill="none"
        stroke="url(#st-gold-b)"
        strokeWidth="1"
        opacity="0.6"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Tooltip: fixed position, so it is never clipped by the scrolling menu.

function useTooltip() {
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const show = useCallback((el: HTMLElement, label: string) => {
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 14 });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <span
      aria-hidden
      className="pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-lg border border-[#D8AF68]/40 bg-[#0D1B33] px-3 py-1.5 text-sm font-medium text-white shadow-lg"
      style={{ top: tip.top, left: tip.left }}
    >
      {tip.label}
    </span>
  ) : null;
  return { show, hide, node };
}

function tipProps(collapsed: boolean, label: string, t: ReturnType<typeof useTooltip>) {
  if (!collapsed) return {};
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => t.show(e.currentTarget, label),
    onMouseLeave: t.hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => t.show(e.currentTarget, label),
    onBlur: t.hide,
  };
}

// ---------------------------------------------------------------------------------------------
// Brand

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/app"
      className={cn('block rounded-lg', FOCUS)}
      aria-label="Signature Tender dashboard"
    >
      {collapsed ? (
        <Image {...BRAND_ASSETS.nibMark} alt="" className="mx-auto h-auto w-10" priority />
      ) : (
        <Image {...BRAND_ASSETS.reversed} alt="" className="h-auto w-[200px]" priority />
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------
// Items

const rowBase =
  'relative flex min-h-11 items-center gap-3 rounded-xl text-[15px] transition-colors duration-150 motion-reduce:transition-none';

function ActiveBar() {
  return (
    <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[#D8AF68]" aria-hidden />
  );
}

function Flyout({
  item,
  anchor,
  onClose,
  pathname,
  tab,
  onNavigate,
}: {
  item: NavItem;
  anchor: HTMLElement;
  onClose: () => void;
  pathname: string;
  tab: string | null;
  onNavigate?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        anchor.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [anchor, onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={item.label}
      className="fixed z-[60] w-56 rounded-2xl border border-[#D8AF68]/30 bg-[#0D1B33] p-2 shadow-2xl"
      style={{ top: Math.min(r.top, window.innerHeight - 320), left: r.right + 12 }}
    >
      <Link
        role="menuitem"
        href={item.href}
        onClick={() => {
          onClose();
          onNavigate?.();
        }}
        className={cn(
          'block rounded-lg px-3 py-2 text-sm font-semibold text-white hover:bg-[#172D4D]',
          FOCUS,
        )}
      >
        {item.label}
      </Link>
      <div className="my-1 h-px bg-white/10" aria-hidden />
      {item.children!.map((c) => {
        const on = isChildActive(pathname, tab, c.href);
        return (
          <Link
            key={c.href}
            role="menuitem"
            href={c.href}
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              onClose();
              onNavigate?.();
            }}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-[#172D4D]',
              on ? 'font-semibold text-white' : 'text-[#CBD5E1]',
              FOCUS,
            )}
          >
            <span
              className={cn('size-1.5 rounded-full', on ? 'bg-[#D8AF68]' : 'bg-transparent')}
              aria-hidden
            />
            {c.label}
          </Link>
        );
      })}
    </div>
  );
}

function SidebarItem({
  item,
  collapsed,
  tooltip,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  tooltip: ReturnType<typeof useTooltip>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const tab = useSearchParams().get('tab');
  const active = isActive(pathname, item.href);
  const hasChildren = Boolean(item.children?.length);
  const [open, setOpen] = useState(active);
  const [flyout, setFlyout] = useState<HTMLElement | null>(null);
  const closeFlyout = useCallback(() => setFlyout(null), []);
  const subId = useId();
  const Icon = NAV_ICONS[item.icon];

  // Navigating into a section opens its submenu; it is never forced closed while you are in it.
  const [lastActive, setLastActive] = useState(active);
  if (lastActive !== active) {
    setLastActive(active);
    if (active) setOpen(true);
  }

  const look = cn(
    rowBase,
    FOCUS,
    active
      ? 'bg-[#172D4D] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
      : 'font-medium text-white/90 hover:bg-[#172D4D] hover:text-white',
  );
  const icon = (
    <Icon
      className={cn('size-5 shrink-0', active ? 'text-[#D8AF68]' : 'text-[#FFF9F2]/90')}
      strokeWidth={1.75}
      aria-hidden
    />
  );

  if (collapsed) {
    if (hasChildren)
      return (
        <li>
          <button
            type="button"
            className={cn(look, 'w-full justify-center')}
            aria-label={item.label}
            aria-haspopup="menu"
            aria-expanded={Boolean(flyout)}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              tooltip.hide();
              const el = e.currentTarget;
              setFlyout((v) => (v ? null : el));
            }}
            {...(flyout ? {} : tipProps(true, item.label, tooltip))}
          >
            {active ? <ActiveBar /> : null}
            {icon}
          </button>
          {flyout ? (
            <Flyout
              item={item}
              anchor={flyout}
              onClose={closeFlyout}
              pathname={pathname}
              tab={tab}
              onNavigate={onNavigate}
            />
          ) : null}
        </li>
      );
    return (
      <li>
        <Link
          href={item.href}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          className={cn(look, 'justify-center')}
          onClick={onNavigate}
          {...tipProps(true, item.label, tooltip)}
        >
          {active ? <ActiveBar /> : null}
          {icon}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <div className={cn(look, 'pr-1')}>
        {active ? <ActiveBar /> : null}
        <Link
          href={item.href}
          aria-current={active && !hasChildren ? 'page' : undefined}
          onClick={onNavigate}
          className={cn(
            'flex min-h-11 flex-1 items-center gap-3 rounded-xl pl-4',
            FOCUS,
            'focus-visible:outline-offset-[-2px]',
          )}
        >
          {icon}
          <span className="truncate">{item.label}</span>
        </Link>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={subId}
            aria-label={`${open ? 'Hide' : 'Show'} ${item.label} pages`}
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white',
              FOCUS,
            )}
          >
            <ChevronDown
              className={cn(
                'size-4 transition-transform duration-150 motion-reduce:transition-none',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
        ) : null}
      </div>
      {hasChildren ? (
        <div
          id={subId}
          className={cn(
            'grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none',
            open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]',
          )}
          inert={!open}
        >
          <ul className="min-h-0 overflow-hidden" aria-label={`${item.label} pages`}>
            {item.children!.map((c) => {
              const on = isChildActive(pathname, tab, c.href);
              return (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    onClick={onNavigate}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'ml-[2.15rem] mt-0.5 flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors duration-150 hover:bg-[#172D4D] motion-reduce:transition-none',
                      on ? 'font-semibold text-white' : 'text-[#CBD5E1] hover:text-white',
                      FOCUS,
                    )}
                  >
                    <span
                      className={cn('h-4 w-0.5 rounded-full', on ? 'bg-[#D8AF68]' : 'bg-white/15')}
                      aria-hidden
                    />
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function SidebarNavigation({
  items,
  collapsed = false,
  onNavigate,
}: {
  items: NavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const tooltip = useTooltip();
  return (
    <>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <SidebarItem
            key={item.href}
            item={item}
            collapsed={collapsed}
            tooltip={tooltip}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      {tooltip.node}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Get Started card

const CTA_BUTTON = cn(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#F3DEB4,#D8AF68)] font-semibold text-[#0D1B33] shadow-[0_6px_18px_rgba(216,175,104,0.25)] transition-[filter,transform] duration-150 hover:brightness-105 active:translate-y-px motion-reduce:transition-none',
  FOCUS,
);

export function SidebarGetStartedCard({
  returning,
  onNavigate,
}: {
  returning: boolean;
  onNavigate?: () => void;
}) {
  return (
    <section
      aria-label={returning ? 'Ready to send' : 'Get started'}
      className="rounded-2xl border border-white/15 bg-white/[0.04] p-4"
    >
      <div className="flex gap-3">
        <Rocket className="mt-0.5 size-7 shrink-0 text-[#D8AF68]" strokeWidth={1.5} aria-hidden />
        <div>
          <p className="font-display text-lg leading-tight text-white">
            {returning ? 'Ready to Send?' : 'Get Started'}
          </p>
          <p className="mt-1 text-sm leading-snug text-[#CBD5E1]">
            {returning
              ? 'Prepare another document for signature.'
              : 'Send your first document for signature in minutes.'}
          </p>
        </div>
      </div>
      <Link
        href="/app/documents/new"
        onClick={onNavigate}
        className={cn(CTA_BUTTON, 'mt-4 w-full px-4 text-[15px]')}
      >
        Create Document <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Desktop sidebar

const BG = 'bg-[linear-gradient(160deg,#0D1B33_0%,#172D4D_55%,#0A1629_100%)]';

export function AppSidebar({ items, initialCollapsed, cta }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltip();

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    // A cookie, not a database write: read by the server on the next page load.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
    tooltip.hide();
  };

  return (
    <aside
      aria-label="Sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'sticky top-0 z-40 hidden h-dvh shrink-0 flex-col text-white transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex',
        BG,
        collapsed ? 'w-20' : 'w-[272px]',
      )}
    >
      <div className={cn('shrink-0 pt-6', collapsed ? 'px-3' : 'px-6')}>
        <SidebarBrand collapsed={collapsed} />
      </div>
      {!collapsed ? <GoldStroke className="mt-2 shrink-0 opacity-80" /> : <div className="h-5" />}

      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        className={cn(
          'absolute -right-4 top-9 z-10 flex size-8 items-center justify-center rounded-full border border-[#F3DEB4]/70 bg-[#0D1B33] text-white shadow-[0_4px_12px_rgba(13,27,51,0.35)] hover:bg-[#172D4D]',
          FOCUS,
        )}
      >
        {collapsed ? (
          <ChevronRight className="size-4" aria-hidden />
        ) : (
          <ChevronLeft className="size-4" aria-hidden />
        )}
      </button>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-4 pt-4 [scrollbar-color:rgba(255,255,255,0.2)_transparent] [scrollbar-width:thin]',
          collapsed ? 'px-3' : 'px-4',
        )}
      >
        <nav aria-label="Primary">
          <SidebarNavigation items={items} collapsed={collapsed} />
        </nav>
        {cta ? (
          collapsed ? (
            <div className="mt-6 flex justify-center border-t border-white/10 pt-5">
              <Link
                href="/app/documents/new"
                aria-label="Create Document"
                className={cn(CTA_BUTTON, 'size-11')}
                {...tipProps(true, 'Create Document', tooltip)}
              >
                <Plus className="size-5" aria-hidden />
              </Link>
            </div>
          ) : (
            <div className="mt-auto pt-6">
              <div className="mb-5 h-px bg-white/10" aria-hidden />
              <SidebarGetStartedCard returning={cta.returning} />
            </div>
          )
        ) : null}
      </div>
      {!collapsed ? <SidebarGoldWave /> : null}
      {tooltip.node}
    </aside>
  );
}

// ---------------------------------------------------------------------------------------------
// Phone and tablet drawer

function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = Array.from(
        ref.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
      if (!els.length) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (!ref.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onEscape, ref]);
}

export function MobileNavigationDrawer({ items, cta }: Omit<SidebarProps, 'initialCollapsed'>) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setShown(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  useFocusTrap(panel, open, close);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setShown(true));
    closeBtn.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-10 items-center justify-center rounded-lg text-[#0D1B33] hover:bg-[#0D1B33]/10"
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-nav"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <div
                className={cn(
                  'absolute inset-0 bg-[#0D1B33]/55 transition-opacity duration-200 motion-reduce:transition-none',
                  shown ? 'opacity-100' : 'opacity-0',
                )}
                onClick={close}
                aria-hidden
              />
              <div
                ref={panel}
                id="mobile-nav"
                className={cn(
                  'absolute inset-y-0 left-0 flex w-[300px] max-w-[86vw] flex-col text-white shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none',
                  BG,
                  shown ? 'translate-x-0' : '-translate-x-full',
                )}
              >
                <div className="flex shrink-0 items-start justify-between px-5 pt-5">
                  <SidebarBrand collapsed={false} />
                  <button
                    ref={closeBtn}
                    type="button"
                    onClick={close}
                    className={cn('rounded-full p-2 text-white hover:bg-white/10', FOCUS)}
                    aria-label="Close navigation"
                  >
                    <X className="size-5" aria-hidden />
                  </button>
                </div>
                <GoldStroke className="mt-1 shrink-0 opacity-70" />
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-6 pt-3">
                  <nav aria-label="Primary">
                    <SidebarNavigation items={items} onNavigate={close} />
                  </nav>
                  {cta ? (
                    <div className="mt-auto pt-6">
                      <SidebarGetStartedCard returning={cta.returning} onNavigate={close} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
