import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonClass } from '@/components/ui/button';
import { SignatureLibrary } from '@/components/studio/library';
import { getSession } from '@/lib/session';
import { libraryItems } from '@/lib/studio-library';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Signatures', robots: { index: false } };

export default async function LibraryPage() {
  const session = await getSession();
  if (!session?.user.emailVerified) redirect(`/sign-in?next=${encodeURIComponent('/signature-studio/continue')}`);
  const items = await libraryItems(session.user.id);
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-heading">My Signatures</h1>
          <p className="mt-1 text-slate-text">Your purchased signatures and saved drafts.</p>
        </div>
        <Link href="/signature-studio#studio" className={buttonClass('primary', 'md')}>
          Create a New Signature
        </Link>
      </div>
      <SignatureLibrary items={items} editHref="/signature-studio" />
    </div>
  );
}
