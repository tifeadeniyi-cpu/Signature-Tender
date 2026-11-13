import Link from 'next/link';
import {
  CircleHelp,
  LogOut,
  UserRound,
  ShieldCheck,
  Plus,
  Search,
  Building2,
  CreditCard,
} from 'lucide-react';
import { hasPermission } from '@st/core';
import type { AppContext } from '@/lib/session';
import { MobileNav } from './sidebar';
import { switchWorkspace, signOut } from './actions';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function Topbar({
  ctx,
  supportEmail,
  allowed,
}: {
  ctx: AppContext;
  supportEmail: string;
  allowed: string[];
}) {
  const { user, membership, workspaces } = ctx;
  const canBill = hasPermission(membership.permissions, 'billing.manage');
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-ivory/95 px-4 backdrop-blur sm:px-6">
      <MobileNav allowed={allowed} />
      <form action="/app/search" role="search" className="ml-auto w-full max-w-md">
        <label htmlFor="global-search" className="sr-only">
          Search documents, contacts, templates and signatures
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-text"
            aria-hidden
          />
          <input
            id="global-search"
            name="q"
            type="search"
            maxLength={100}
            placeholder="Search documents, contacts..."
            className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-dark-text placeholder:text-slate-text focus:border-primary-hover focus:outline-none focus:ring-2 focus:ring-gold/50"
          />
        </div>
      </form>
      <a
        href={`mailto:${supportEmail}`}
        className="flex size-10 items-center justify-center rounded-lg text-primary hover:bg-primary-surface"
        aria-label="Help: email support"
        title="Help"
      >
        <CircleHelp className="size-5" aria-hidden />
      </a>
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-primary-surface [&::-webkit-details-marker]:hidden">
          <span
            className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white"
            aria-hidden
          >
            {initials(user.name) || '?'}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-semibold text-heading">{user.name}</span>
            <span className="block max-w-40 truncate text-xs">{membership.workspace.name}</span>
          </span>
          <span className="sr-only">Open account menu</span>
        </summary>
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-white p-2 shadow-card">
          <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Workspaces
          </p>
          <ul className="mt-1">
            {workspaces.map((w) => (
              <li key={w.id}>
                <form action={switchWorkspace}>
                  <input type="hidden" name="workspaceId" value={w.id} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-blush"
                    aria-current={w.id === membership.workspace.id ? 'true' : undefined}
                  >
                    <span className="truncate text-heading">{w.name}</span>
                    <span className="text-xs">
                      {w.id === membership.workspace.id ? 'Current' : w.roleName}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
          <Link
            href="/onboarding?new=1"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary hover:bg-blush"
          >
            <Plus className="size-4" aria-hidden /> New workspace
          </Link>
          <hr className="my-2 border-border" />
          <Link
            href="/app/settings/profile"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-heading hover:bg-blush"
          >
            <UserRound className="size-4" aria-hidden /> Profile
          </Link>
          <Link
            href="/app/settings"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-heading hover:bg-blush"
          >
            <Building2 className="size-4" aria-hidden /> Workspace
          </Link>
          {canBill ? (
            <Link
              href="/app/billing"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-heading hover:bg-blush"
            >
              <CreditCard className="size-4" aria-hidden /> Billing
            </Link>
          ) : null}
          <Link
            href="/app/settings/security"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-heading hover:bg-blush"
          >
            <ShieldCheck className="size-4" aria-hidden /> Security
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-heading hover:bg-blush"
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      </details>
    </header>
  );
}
