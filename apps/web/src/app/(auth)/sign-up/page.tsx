import { readClaimEmail } from '@/lib/completed';
import { safeNextPath } from '@/lib/next-path';
import { SignUpForm } from './form';

export const dynamic = 'force-dynamic';

/**
 * Sign-up. After a recipient chose "Create Free Account" on a completed document, the address
 * they just verified is prefilled (from a short-lived httpOnly cookie, never the URL).
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const email = next?.startsWith('/claim/') ? await readClaimEmail() : null;
  return (
    <SignUpForm
      defaultEmail={email}
      claim={Boolean(next?.startsWith('/claim/'))}
      studio={Boolean(next?.startsWith('/signature-studio/'))}
    />
  );
}
