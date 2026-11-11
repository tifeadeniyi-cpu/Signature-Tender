import Image from 'next/image';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-ivory to-blush px-4 py-10">
      <Link href="/" aria-label="Signature Tender home" className="mb-6">
        <Image
          src="/brand/logo-stacked.png"
          alt="Signature Tender"
          width={255}
          height={213}
          className="h-auto w-36"
          priority
        />
      </Link>
      <main
        id="main"
        className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-card sm:p-8"
      >
        {children}
      </main>
      <p className="mt-6 text-center text-xs">
        <Link href="/legal/terms" className="underline-offset-2 hover:underline">
          Terms
        </Link>{' '}
        ·{' '}
        <Link href="/legal/privacy" className="underline-offset-2 hover:underline">
          Privacy
        </Link>
      </p>
    </div>
  );
}
