import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { buttonClass } from '@/components/ui/button';
import { SignatureLibrary } from '@/components/studio/library';
import { requireWorkspace } from '@/lib/session';
import { libraryItems } from '@/lib/studio-library';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Signatures' };

export default async function AppLibraryPage() {
  const { user } = await requireWorkspace();
  const items = await libraryItems(user.id);
  return (
    <div>
      <PageHeader
        title="My Signatures"
        description="Your purchased signatures and saved drafts from Signature Studio."
        actions={
          <Link href="/app/signature-studio" className={buttonClass('primary', 'md')}>
            Create a New Signature
          </Link>
        }
      />
      <SignatureLibrary items={items} editHref="/app/signature-studio" />
    </div>
  );
}
