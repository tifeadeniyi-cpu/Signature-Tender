import Image from 'next/image';
import { getConfigValue } from '@st/core';
import { db } from '@/lib/db';
import { HelpMenu } from './help-menu';

/** Matches the background of the reversed logo so it sits seamlessly in the header. */
const LOGO_BG = '#0d1b33';

/**
 * Branded header and footer for recipient pages outside the signing workspace (landing,
 * verification, consent, status and success screens). No app navigation. Mobile-first. The
 * workspace is full-screen and renders its own header with Help and Save & Exit.
 */
export async function SignChrome({ children }: { children: React.ReactNode }) {
  const supportEmail = await getConfigValue(
    db(),
    'support.email',
    'support@signaturetender.com',
  ).catch(() => 'support@signaturetender.com');
  return (
    <div className="flex min-h-dvh flex-col bg-ivory">
      <header className="relative text-white" style={{ backgroundColor: LOGO_BG }}>
        <div className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:h-20 sm:px-6">
          <a
            href="/"
            target="_blank"
            rel="noopener"
            aria-label="Signature Tender home (opens in a new tab)"
          >
            <Image
              src="/brand/logo-reversed.png"
              alt="Signature Tender"
              width={327}
              height={168}
              className="h-12 w-auto rounded-md sm:h-16"
              priority
            />
          </a>
          <HelpMenu supportEmail={String(supportEmail)} />
        </div>
        <Wave className="absolute inset-x-0 -bottom-px h-6 w-full sm:h-10" />
      </header>
      <div className="flex-1">{children}</div>
      <footer className="relative mt-12 text-white" style={{ backgroundColor: LOGO_BG }}>
        <Wave flip className="absolute inset-x-0 -top-px h-6 w-full sm:h-10" />
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 pb-8 pt-12 sm:flex-row sm:justify-between sm:px-6 sm:pt-14">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
            <Image
              src="/brand/logo-reversed.png"
              alt="Signature Tender"
              width={327}
              height={168}
              className="h-12 w-auto rounded-md"
            />
            <span className="hidden h-10 w-px bg-white/30 sm:block" aria-hidden />
            <p className="font-display text-lg italic text-white/90">Send. Sign. Pay Once.</p>
          </div>
          <nav aria-label="Legal and support">
            <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
              <li>
                <a
                  href="/legal/privacy"
                  target="_blank"
                  rel="noopener"
                  className="underline underline-offset-4 hover:text-gold"
                >
                  Privacy Policy
                </a>
              </li>
              <li>
                <a
                  href="/legal/terms"
                  target="_blank"
                  rel="noopener"
                  className="underline underline-offset-4 hover:text-gold"
                >
                  Terms of Service
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${String(supportEmail)}`}
                  className="underline underline-offset-4 hover:text-gold"
                >
                  Help &amp; Support
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Thin champagne-gold curve between the navy bands and the ivory page. */
function Wave({ className, flip }: { className?: string; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 1440 60"
      preserveAspectRatio="none"
      className={className}
      style={flip ? { transform: 'scaleY(-1)' } : undefined}
      aria-hidden
    >
      <path d="M0 30 C 360 70, 900 -10, 1440 28 L1440 60 L0 60 Z" fill="#d8af68" />
      <path d="M0 40 C 420 72, 960 8, 1440 40 L1440 60 L0 60 Z" fill="#fff9f2" />
    </svg>
  );
}
