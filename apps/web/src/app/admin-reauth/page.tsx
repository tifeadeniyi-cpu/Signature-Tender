import { ShieldCheck } from 'lucide-react';
import { signOut } from '@/components/shell/actions';
import { buttonClass } from '@/components/ui/button';

export const metadata = { title: 'Sign in again', robots: { index: false } };

/** Staff sessions last 12 hours (see requireStaff); this is where an older one is sent. */
export default function AdminReauthPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <ShieldCheck className="size-10 text-gold" aria-hidden />
      <h1 className="mt-3 font-display text-3xl">Sign in again</h1>
      <p className="mt-2 text-sm">
        For security, admin sessions last 12 hours. Sign out and sign back in to keep using the
        admin portal. Your customer account is not affected.
      </p>
      <form action={signOut} className="mt-6">
        <button type="submit" className={buttonClass('primary')}>
          Sign out and sign in again
        </button>
      </form>
    </main>
  );
}
