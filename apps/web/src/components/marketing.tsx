import Image from 'next/image';
import Link from 'next/link';

export function MarketingHeader() {
  return (
    <header className="bg-primary text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" aria-label="Signature Tender home">
          <Image
            src="/brand/logo-reversed.png"
            alt="Signature Tender"
            width={327}
            height={168}
            className="h-auto w-36 rounded-lg"
            priority
          />
        </Link>
        <nav aria-label="Main" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex gap-6 text-sm">
            <li>
              <Link href="/#how-it-works" className="hover:text-rose-gold">
                How It Works
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="hover:text-rose-gold">
                Pricing
              </Link>
            </li>
          </ul>
        </nav>
        <div className="flex gap-2">
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center rounded-lg border border-white/40 px-4 text-sm font-semibold hover:bg-white/10"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center rounded-lg bg-rose-gold px-4 text-sm font-semibold text-primary-dark hover:bg-blush"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm sm:px-6">
        <p>© {new Date().getFullYear()} Signature Tender. Send. Sign. Pay Once.</p>
        <nav aria-label="Legal">
          <ul className="flex gap-4">
            <li>
              <Link href="/legal/terms" className="hover:underline">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/legal/privacy" className="hover:underline">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/legal/esign-disclosure" className="hover:underline">
                Electronic Signature Disclosure
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
