import Image from 'next/image';
import Link from 'next/link';
import { CircleHelp, FolderOpen } from 'lucide-react';

/**
 * Burgundy header for public recipient pages (completed documents, retrieval, claimed documents).
 * Visitors who are not signed in see Help and Sign In only; signed-in users see a link to their
 * documents instead of Sign In. No dashboard navigation is shown here.
 */
export function PublicHeader({
  user,
  supportEmail,
  signInNext,
}: {
  user: { name: string } | null;
  supportEmail: string;
  /** Where Sign In should return to (an allowed `next` path). */
  signInNext?: string | null;
}) {
  return (
    <header className="relative isolate overflow-hidden bg-gradient-to-r from-primary-dark via-primary to-primary-hover text-white">
      <svg
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-7 w-full sm:h-9"
        viewBox="0 0 1440 40"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M0 22 C 260 4 520 4 760 18 C 1000 32 1240 34 1440 14 L1440 40 L0 40 Z"
          fill="#7f1d3a"
          opacity="0.6"
        />
        <path
          d="M0 30 C 300 12 560 14 800 26 C 1040 38 1260 36 1440 24 L1440 40 L0 40 Z"
          fill="#fff9f7"
        />
        <path
          d="M0 30 C 300 12 560 14 800 26 C 1040 38 1260 36 1440 24"
          fill="none"
          stroke="#e6b8a7"
          strokeWidth="1.5"
        />
      </svg>
      <div className="mx-auto flex h-20 max-w-[1600px] items-start gap-3 px-4 pt-3 sm:h-24 sm:px-6 sm:pt-4">
        <Link href="/" aria-label="Signature Tender home" className="shrink-0">
          <Image
            src="/brand/logo-reversed.png"
            alt="Signature Tender"
            width={327}
            height={168}
            className="h-11 w-auto rounded-md shadow-[0_0_0_1px_rgb(230_184_167/0.25)] sm:h-12"
            priority
          />
        </Link>
        <div className="flex-1" />
        <a
          href={`mailto:${supportEmail}`}
          className="flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium text-white hover:bg-white/10 sm:px-3"
        >
          <CircleHelp className="size-5" aria-hidden />
          <span>Help</span>
        </a>
        <span className="hidden h-6 w-px bg-white/30 sm:block" aria-hidden />
        {user ? (
          <Link
            href="/my-documents"
            className="flex h-10 items-center gap-2 rounded-lg border border-white/70 px-3 text-sm font-semibold text-white hover:bg-white/10 sm:px-5"
          >
            <FolderOpen className="size-4" aria-hidden />
            <span className="hidden sm:inline">My documents</span>
            <span className="sm:hidden">Documents</span>
          </Link>
        ) : (
          <Link
            href={signInNext ? `/sign-in?next=${encodeURIComponent(signInNext)}` : '/sign-in'}
            className="flex h-10 items-center rounded-lg border border-white/70 px-4 text-sm font-semibold text-white hover:bg-white/10 sm:px-6"
          >
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
